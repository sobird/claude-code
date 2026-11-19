/**
 * Assistant (KAIROS) session discovery.
 *
 * `claude assistant` without a session id attaches to a live remote assistant
 * session. We list the account's code sessions through the Sessions API
 * (`GET /v1/sessions`) and keep the ones currently attachable (idle, working,
 * waiting); completed/archived sessions are not viewer targets.
 *
 * `daemon.json` in the Claude config home is a separate concern: it records
 * where `claude assistant` installed the daemon so `/assistant` can report the
 * install location. It is not the source of session discovery.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import type { CodeSession } from '../utils/teleport/api.js'

export type AssistantSession = {
  /** Remote session id (`session_*`) used by the viewer client. */
  id: string
  title?: string
  /** Session status (`idle` | `working` | `waiting`) shown in the chooser. */
  status?: string
  /** ISO timestamp of the last update, for display and sorting. */
  updatedAt?: string
  /** Workspace directory the session belongs to, when known. */
  directory?: string
}

export type DaemonConfig = {
  installedDir: string
  installedAt: string
  sessions: AssistantSession[]
}

const DAEMON_CONFIG_FILENAME = 'daemon.json'

export function getDaemonConfigPath(): string {
  return join(getClaudeConfigHomeDir(), DAEMON_CONFIG_FILENAME)
}

function normalizeSession(value: unknown): AssistantSession | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  return {
    id: record.id,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
    ...(typeof record.directory === 'string' ? { directory: record.directory } : {}),
  }
}

/**
 * Reads and validates `daemon.json`. Missing or malformed files yield null so
 * callers can treat "not installed" and "corrupt config" the same.
 */
export async function readDaemonConfig(): Promise<DaemonConfig | null> {
  let raw: string
  try {
    raw = await readFile(getDaemonConfigPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logForDebugging(`[assistant] failed to read daemon config: ${errorMessage(error)}`)
    }
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logForDebugging('[assistant] daemon config is not valid JSON')
    return null
  }

  // Tolerate a bare sessions array as well as the full config object.
  const record = Array.isArray(parsed) ? { sessions: parsed } : parsed
  if (typeof record !== 'object' || record === null) return null
  const config = record as Record<string, unknown>
  const sessions = Array.isArray(config.sessions)
    ? config.sessions.map(normalizeSession).filter((s): s is AssistantSession => s !== null)
    : []

  return {
    installedDir: typeof config.installedDir === 'string' ? config.installedDir : '',
    installedAt: typeof config.installedAt === 'string' ? config.installedAt : '',
    sessions,
  }
}

/** Writes `daemon.json`, creating the config home if needed. */
export async function writeDaemonConfig(config: DaemonConfig): Promise<void> {
  const path = getDaemonConfigPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/**
 * Lists the account's attachable assistant sessions (idle, working, waiting),
 * newest first. Throws on API failure so the caller can surface the error
 * instead of silently treating a failed lookup as "no sessions installed".
 */
export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  const { fetchCodeSessionsFromSessionsAPI } = await import('../utils/teleport/api.js')

  let allSessions: CodeSession[]
  try {
    allSessions = await fetchCodeSessionsFromSessionsAPI()
  } catch (error) {
    logForDebugging(`[assistant] failed to discover sessions: ${errorMessage(error)}`)
    throw error
  }

  return allSessions
    .filter((session) => session.status === 'idle' || session.status === 'working' || session.status === 'waiting')
    .map((session) => ({
      id: session.id,
      title: session.title || 'Untitled',
      status: session.status,
      updatedAt: session.updated_at || session.created_at,
    }))
    .toSorted((a, b) => {
      const at = a.updatedAt ? Date.parse(a.updatedAt) : Number.NaN
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : Number.NaN
      if (Number.isNaN(at) && Number.isNaN(bt)) return a.id.localeCompare(b.id)
      if (Number.isNaN(at)) return 1
      if (Number.isNaN(bt)) return -1
      return bt - at
    })
}
