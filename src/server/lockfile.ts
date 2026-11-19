import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export interface ServerLockInfo {
  pid: number
  port: number
  host: string
  httpUrl: string
  startedAt: number
}

const LOCK_FILENAME = 'server.lock'

function getServerLockPath(): string {
  return join(getClaudeConfigHomeDir(), LOCK_FILENAME)
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

function isValidLockInfo(value: unknown): value is ServerLockInfo {
  if (typeof value !== 'object' || value === null) return false
  const info = value as Record<string, unknown>
  return (
    typeof info.pid === 'number' &&
    typeof info.port === 'number' &&
    typeof info.host === 'string' &&
    typeof info.httpUrl === 'string' &&
    typeof info.startedAt === 'number'
  )
}

/**
 * Persists the running server's identity so a second `claude server` invocation
 * can detect it and refuse to start a duplicate.
 */
export async function writeServerLock(info: ServerLockInfo): Promise<void> {
  const lockPath = getServerLockPath()
  await mkdir(dirname(lockPath), { recursive: true })
  await writeFile(lockPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8')
}

/** Removes the lock file; missing files are ignored. */
export async function removeServerLock(): Promise<void> {
  try {
    await unlink(getServerLockPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Returns the lock for a live server, or null. A stale lock (unparseable, or
 * whose owner process has exited) is deleted before returning null so it never
 * blocks a fresh start.
 */
export async function probeRunningServer(): Promise<ServerLockInfo | null> {
  let raw: string
  try {
    raw = await readFile(getServerLockPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    await removeServerLock()
    return null
  }

  if (!isValidLockInfo(parsed) || !isProcessAlive(parsed.pid)) {
    await removeServerLock()
    return null
  }

  return parsed
}
