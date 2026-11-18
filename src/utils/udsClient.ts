/**
 * Client side of the cross-session UDS inbox (see udsMessaging.ts).
 */

import { readdir, readFile } from 'node:fs/promises'
import net from 'node:net'
import { join } from 'node:path'

import { getClaudeConfigHomeDir } from './envUtils.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { jsonParse } from './slowOperations.js'

/** Give up on a send that can't even establish a connection. */
const CONNECT_TIMEOUT_MS = 5_000

/**
 * Send a plain-text message to another session's inbox. The receiver wraps it
 * in `<cross-session-message from="...">` before enqueueing.
 */
export async function sendToUdsSocket(target: string, message: string): Promise<void> {
  const frame = JSON.stringify({
    from: process.env.CLAUDE_CODE_MESSAGING_SOCKET,
    message,
  })

  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(target)
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error(`Timed out connecting to ${target}`)), CONNECT_TIMEOUT_MS)

    socket.once('connect', () => {
      socket.end(`${frame}\n`)
    })
    socket.once('close', () => finish())
    socket.once('error', (error) => finish(error))
  })
}

type LiveSession = {
  kind?: string
  sessionId?: string
}

/**
 * Enumerate sessions with a live PID file in `~/.claude/sessions/`.
 *
 * The strict `<pid>.json` filename guard mirrors countConcurrentSessions():
 * loose parsing would treat a dated notes file as a PID and, worse, let stale
 * sweeping delete user data. Dead PIDs are skipped (their files are swept by
 * the concurrent-session counter).
 */
export async function listAllLiveSessions(): Promise<LiveSession[]> {
  const dir = join(getClaudeConfigHomeDir(), 'sessions')
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    // No sessions dir (first run) or unreadable — callers treat an empty list
    // as "no peers".
    return []
  }

  const sessions: LiveSession[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid || !isProcessRunning(pid)) continue
    try {
      const data = jsonParse(await readFile(join(dir, file), 'utf8')) as Record<string, unknown>
      sessions.push({
        kind: typeof data.kind === 'string' ? data.kind : undefined,
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
      })
    } catch {
      // Raced with cleanup or partially written — skip this entry.
    }
  }
  return sessions
}
