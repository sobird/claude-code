/**
 * Per-turn session environment snapshots (ant-only internal build).
 *
 * At each turn boundary this captures the git/filesystem state — deliberately
 * NOT the transcript — and uploads it so a session's environment can be
 * recreated at any user-message index. Runs only when the working directory is
 * an Anthropic-owned repo and `gcloud` is authenticated; both checks happen
 * every turn so mid-session auth recovery starts uploading without a restart.
 */

import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { getSessionId } from '../bootstrap/state.js'
import type { Message } from '../types/message.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage } from './errors.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { findGitRoot } from './git.js'

/** `gs://` bucket receiving snapshots; overridable for testing. */
const DEFAULT_BUCKET = 'claude-code-session-environments'
/** Bound per-turn work: at most this many files, each at most this many bytes. */
const MAX_FILES = 50
const MAX_FILE_BYTES = 64 * 1024
/** Remote substrings that mark an Anthropic-owned repo. */
const ANTHROPIC_REMOTE_MARKERS = ['github.com/anthropics/', 'github.com/anthropic/']

type FileSnapshot = {
  path: string
  content?: string
  truncated?: boolean
}

type TurnSnapshot = {
  version: 1
  sessionId: string
  turn: number
  timestamp: string
  cwd: string
  messageCount: number
  git: {
    head: string | null
    branch: string | null
    status: string
  }
  files: FileSnapshot[]
}

async function isAnthropicRepo(cwd: string): Promise<boolean> {
  const remote = await execFileNoThrowWithCwd('git', ['remote', 'get-url', 'origin'], { cwd })
  if (remote.code !== 0) {
    return false
  }
  const url = remote.stdout.toLowerCase()
  return ANTHROPIC_REMOTE_MARKERS.some((marker) => url.includes(marker))
}

async function getGcloudAccount(): Promise<string | null> {
  const result = await execFileNoThrowWithCwd('gcloud', ['config', 'get-value', 'account'])
  const account = result.stdout.trim()
  if (result.code !== 0 || account.length === 0 || account === '(unset)') {
    return null
  }
  return account
}

async function captureFiles(repoRoot: string, status: string): Promise<FileSnapshot[]> {
  const paths: string[] = []
  for (const line of status.split('\n')) {
    if (line.length < 4) continue
    // `XY path`; skip renames' "old -> new" form and take the new path.
    const rawPath = line.slice(3)
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()! : rawPath
    if (path.length > 0) paths.push(path)
    if (paths.length >= MAX_FILES) break
  }

  const files: FileSnapshot[] = []
  for (const path of paths) {
    const absolute = join(repoRoot, path)
    try {
      const info = await stat(absolute)
      if (!info.isFile()) continue
      if (info.size > MAX_FILE_BYTES) {
        files.push({ path, truncated: true })
        continue
      }
      files.push({ path, content: await readFile(absolute, 'utf8') })
    } catch {
      // Deleted or unreadable (binary, permissions) — record the path only.
      files.push({ path })
    }
  }
  return files
}

async function captureSnapshot(cwd: string, turn: number, messages: Message[]): Promise<TurnSnapshot> {
  const repoRoot = findGitRoot(cwd) ?? cwd
  const head = await execFileNoThrowWithCwd('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
  const branch = await execFileNoThrowWithCwd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot })
  const status = await execFileNoThrowWithCwd('git', ['status', '--porcelain'], { cwd: repoRoot })

  return {
    version: 1,
    sessionId: getSessionId(),
    turn,
    timestamp: new Date().toISOString(),
    cwd,
    messageCount: messages.length,
    git: {
      head: head.code === 0 ? head.stdout.trim() || null : null,
      branch: branch.code === 0 ? branch.stdout.trim() || null : null,
      status: status.code === 0 ? status.stdout.trimEnd() : '',
    },
    files: status.code === 0 ? await captureFiles(repoRoot, status.stdout) : [],
  }
}

async function uploadTurn(turn: number, messages: Message[]): Promise<void> {
  const cwd = getCwd()
  if (!(await isAnthropicRepo(cwd))) {
    return
  }
  const account = await getGcloudAccount()
  if (account === null) {
    logForDebugging('[sessionData] gcloud not authenticated; skipping upload')
    return
  }

  const snapshot = await captureSnapshot(cwd, turn, messages)
  const bucket = process.env.CLAUDE_CODE_SESSION_DATA_BUCKET ?? DEFAULT_BUCKET
  const destination = `gs://${bucket}/${snapshot.sessionId}/turn-${turn}.json`
  const tempPath = join(tmpdir(), `cc-session-${process.pid}-${randomUUID()}.json`)

  await writeFile(tempPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
  try {
    const upload = await execFileNoThrowWithCwd('gcloud', ['storage', 'cp', tempPath, destination], { cwd })
    if (upload.code !== 0) {
      logForDebugging(`[sessionData] upload failed (${basename(destination)}): ${upload.error ?? upload.stderr}`)
    }
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

/**
 * Returns a per-turn callback, or null when uploading is disabled for this
 * process (tests and explicit opt-outs set the env var). The callback never
 * throws: all failures degrade to a debug log so a turn is never blocked on
 * telemetry.
 */
export function createSessionTurnUploader(): ((messages: Message[]) => void) | null {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SESSION_DATA_UPLOAD)) {
    return null
  }

  let turn = 0
  let inFlight = false

  return (messages: Message[]) => {
    if (inFlight) {
      return
    }
    inFlight = true
    turn += 1
    const currentTurn = turn
    void uploadTurn(currentTurn, messages)
      .catch((error: unknown) => {
        logForDebugging(`[sessionData] turn ${currentTurn} failed: ${errorMessage(error)}`)
      })
      .finally(() => {
        inFlight = false
      })
  }
}
