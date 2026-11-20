/**
 * Cross-session inbox server (Unix domain socket).
 *
 * Each interactive/session process can bind a socket under
 * `$TMPDIR/cc-socks/<pid>.sock` (or an explicit --messaging-socket-path). Peers
 * send newline-delimited JSON `{from, message}` frames; we wrap each message in
 * a `<cross-session-message from="...">` block and enqueue it as a prompt so it
 * drains at the receiver's next tool round, exactly like a teammate message.
 *
 * If another transferable peer sends us its `from`, the model can reply by
 * passing it back as `to` — see SendMessageTool's `uds:/path` addressing.
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, unlink } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CROSS_SESSION_MESSAGE_TAG } from '../constants/xml.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { enqueue } from './messageQueueManager.js'

/** Upper bound on a single unterminated frame — a misbehaving peer must not
 *  be able to grow our buffer without bound. */
const MAX_BUFFER_BYTES = 1_000_000

let server: net.Server | null = null
let activeSocketPath: string | null = null
let onEnqueue: (() => void) | null = null

/** Register the callback invoked after an inbound message is enqueued. Used by
 *  headless mode to kick off the query loop (there's no queue subscriber). */
export function setOnEnqueue(callback: () => void): void {
  onEnqueue = callback
}

/** The socket this process is listening on, if the server started. Surfaced in
 *  the init message so SDK consumers can address this session. */
export function getUdsMessagingSocketPath(): string | undefined {
  return activeSocketPath ?? undefined
}

/** Default per-process socket. PID-scoped so concurrent sessions never collide. */
export function getDefaultUdsSocketPath(): string {
  return join(tmpdir(), 'cc-socks', `${process.pid}.sock`)
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function formatMessage(from: string, message: string): string {
  return `<${CROSS_SESSION_MESSAGE_TAG} from="${escapeAttribute(from)}">\n${message}\n</${CROSS_SESSION_MESSAGE_TAG}>`
}

function handleFrame(line: string): void {
  let payload: unknown
  try {
    payload = JSON.parse(line)
  } catch {
    logForDebugging('[uds] dropping malformed frame')
    return
  }
  if (typeof payload !== 'object' || payload === null) {
    return
  }
  const { from, message } = payload as { from?: unknown; message?: unknown }
  if (typeof message !== 'string') {
    logForDebugging('[uds] dropping frame without a message')
    return
  }
  const sender = typeof from === 'string' && from.length > 0 ? from : 'unknown'

  enqueue({
    value: formatMessage(sender, message),
    mode: 'prompt',
    priority: 'next',
    uuid: randomUUID(),
    skipSlashCommands: true,
    origin: { kind: 'cross-session' },
  })
  onEnqueue?.()
}

/** True if some process is already accepting connections on `path`. */
function isSocketLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(path)
    const finish = (live: boolean): void => {
      probe.destroy()
      resolve(live)
    }
    probe.once('connect', () => finish(true))
    probe.once('error', () => finish(false))
    probe.setTimeout(200, () => finish(false))
  })
}

async function bind(server: net.Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(path, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

/**
 * Start the inbox server. Awaited during setup so `$CLAUDE_CODE_MESSAGING_SOCKET`
 * is exported before SessionStart hooks can snapshot process.env.
 *
 * Failure is non-fatal for the auto-generated socket (messaging is optional)
 * but surfaces for an explicit --messaging-socket-path — the caller asked for
 * it, so silently ignoring a bad path would be confusing.
 */
export async function startUdsMessaging(socketPath: string, options: { isExplicit: boolean }): Promise<void> {
  if (process.platform === 'win32') {
    if (options.isExplicit) {
      throw new Error('UDS messaging is not supported on Windows')
    }
    return
  }
  if (server !== null) {
    return
  }

  if (await isSocketLive(socketPath)) {
    const message = `socket already in use: ${socketPath}`
    if (options.isExplicit) {
      throw new Error(message)
    }
    logForDebugging(`[uds] ${message}; not starting inbox`)
    return
  }
  // No listener — the file is a leftover from a crashed session.
  await unlink(socketPath).catch(() => {})

  try {
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
  } catch (error) {
    if (options.isExplicit) {
      throw error
    }
    logForDebugging(`[uds] failed to create ${dirname(socketPath)}: ${errorMessage(error)}`)
    return
  }

  const created = net.createServer((connection) => {
    connection.setEncoding('utf8')
    let buffer = ''
    connection.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_BUFFER_BYTES) {
        logForDebugging('[uds] frame exceeded buffer limit; dropping connection')
        connection.destroy()
        return
      }
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length > 0) {
          handleFrame(line)
        }
      }
    })
    connection.on('error', (error) => {
      logForDebugging(`[uds] connection error: ${errorMessage(error)}`)
    })
  })

  try {
    await bind(created, socketPath)
  } catch (error) {
    if (options.isExplicit) {
      throw error
    }
    logForDebugging(`[uds] failed to bind ${socketPath}: ${errorMessage(error)}`)
    return
  }

  // Only this user should be able to inject messages into the session.
  await chmod(socketPath, 0o600).catch(() => {})

  created.on('error', (error) => {
    logForDebugging(`[uds] server error: ${errorMessage(error)}`)
  })

  server = created
  activeSocketPath = socketPath
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = socketPath
  logForDebugging(`[uds] inbox listening on ${socketPath}${options.isExplicit ? ' (explicit)' : ''}`)

  registerCleanup(async () => {
    server?.close()
    server = null
    activeSocketPath = null
    await unlink(socketPath).catch(() => {})
  })
}
