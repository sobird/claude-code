/**
 * Daemon supervisor state, persisted so `status` / `stop` work from a
 * different CLI process than the one that started the daemon.
 *
 * Lives at `~/.claude/daemon/<name>.json`. This is distinct from
 * `~/.claude/daemon.json`, which is the assistant install record read by
 * `assistant/sessionDiscovery.ts` and `/assistant`.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

/** Worker exit code for non-retryable failures (EX_CONFIG from sysexits.h). */
export const EXIT_CODE_PERMANENT = 78

/** Worker exit code for transient failures the supervisor should retry. */
export const EXIT_CODE_TRANSIENT = 1

export interface DaemonStateData {
  pid: number
  cwd: string
  startedAt: string
  workerKinds: string[]
  lastStatus: 'running' | 'stopped' | 'error'
}

export type DaemonStatus = 'running' | 'stopped' | 'stale'

const DEFAULT_DAEMON_NAME = 'remote-control'
const DEFAULT_STOP_TIMEOUT_MS = 10_000
const STOP_POLL_INTERVAL_MS = 200
const KILL_GRACE_MS = 500

export function getDaemonStateFilePath(name = DEFAULT_DAEMON_NAME): string {
  return join(getClaudeConfigHomeDir(), 'daemon', `${name}.json`)
}

/** `kill(pid, 0)` probes liveness without signalling; EPERM still means alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Writes the state file, creating `~/.claude/daemon/` if needed. */
export async function writeDaemonState(state: DaemonStateData, name = DEFAULT_DAEMON_NAME): Promise<void> {
  const path = getDaemonStateFilePath(name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** Reads the state file; missing or malformed files yield null. */
export async function readDaemonState(name = DEFAULT_DAEMON_NAME): Promise<DaemonStateData | null> {
  try {
    const raw = await readFile(getDaemonStateFilePath(name), 'utf8')
    return JSON.parse(raw) as DaemonStateData
  } catch {
    return null
  }
}

/** Removes the state file; missing files are ignored. */
export async function removeDaemonState(name = DEFAULT_DAEMON_NAME): Promise<void> {
  try {
    await unlink(getDaemonStateFilePath(name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Reads the state file and probes the recorded PID:
 *   - `running` — PID is alive
 *   - `stopped` — no state file
 *   - `stale`   — state file exists but the PID is gone (cleaned up)
 */
export async function queryDaemonStatus(
  name = DEFAULT_DAEMON_NAME,
): Promise<{ status: DaemonStatus; state?: DaemonStateData }> {
  const state = await readDaemonState(name)
  if (!state) return { status: 'stopped' }
  if (isProcessAlive(state.pid)) return { status: 'running', state }
  await removeDaemonState(name)
  return { status: 'stale' }
}

/**
 * Stops a running daemon: SIGTERM, poll until it exits, then SIGKILL after the
 * timeout. Always cleans up the state file. Returns true if a live daemon was
 * signalled (whether or not it exited before the SIGKILL fallback).
 */
export async function stopDaemonByPid(
  name = DEFAULT_DAEMON_NAME,
  timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
): Promise<boolean> {
  const state = await readDaemonState(name)
  if (!state) return false

  const { pid } = state
  if (!isProcessAlive(pid)) {
    await removeDaemonState(name)
    return false
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    await removeDaemonState(name)
    return false
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      await removeDaemonState(name)
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS))
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already exited between the poll and the kill.
  }

  await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS))
  await removeDaemonState(name)
  return true
}
