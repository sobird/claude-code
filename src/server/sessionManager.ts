/**
 * Session lifecycle for `claude server` (direct-connect).
 *
 * A `SessionManager` owns the sessions a server hands out. Each session wraps a
 * backend child process (spawned by an injected `SessionBackend`) and enforces
 * the limits from the server config: a hard cap on concurrent sessions and an
 * idle timeout that reaps sessions nobody is talking to.
 *
 * The manager is transport-agnostic — the HTTP/WebSocket layer in `server.ts`
 * creates sessions, bridges lines to clients, and calls `destroy*` on shutdown.
 */

import { randomUUID } from 'node:crypto'

import type { SessionInfo, SessionState } from './types.js'

export type BackendExitInfo = { code: number | null; signal: NodeJS.Signals | null }

/**
 * A live child process owned by a session. Single-consumer: the `ManagedSession`
 * registers the line/exit callbacks once and fans them out to its subscribers.
 */
export interface BackendSession {
  pid?: number
  writeStdin(data: string): void
  onLine(cb: (line: string) => void): void
  onExit(cb: (info: BackendExitInfo) => void): void
  kill(): void
  getStderrTail(): string
}

export interface BackendSpawnOpts {
  sessionId: string
  cwd: string
  permissionMode?: string
  dangerouslySkipPermissions: boolean
}

export interface SessionBackend {
  spawn(opts: BackendSpawnOpts): BackendSession
}

export interface SessionManagerOptions {
  idleTimeoutMs?: number
  maxSessions?: number
  workspace?: string
  now?: () => number
  generateId?: () => string
  /** Background sweep cadence. 0 disables it (tests drive `sweep()` directly). */
  sweepIntervalMs?: number
  /** How long `destroy*` waits for a session to exit before giving up. */
  destroyGraceMs?: number
}

export interface CreateSessionOptions {
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
}

export class SessionLimitError extends Error {
  constructor(limit: number) {
    super(`Maximum number of concurrent sessions reached (${limit})`)
    this.name = 'SessionLimitError'
  }
}

interface ManagedSessionParams {
  id: string
  workDir: string
  backend: BackendSession
  now: () => number
  createdAt: number
}

export class ManagedSession {
  readonly id: string
  readonly workDir: string
  readonly createdAt: number

  private readonly backend: BackendSession
  private readonly now: () => number
  private readonly lineListeners = new Set<(line: string) => void>()
  private readonly exitListeners = new Set<(info: BackendExitInfo) => void>()
  private readonly doneResolvers = new Set<() => void>()
  private _status: SessionState = 'running'
  private _lastActiveAt: number
  private exitInfo: BackendExitInfo | undefined

  constructor({ id, workDir, backend, now, createdAt }: ManagedSessionParams) {
    this.id = id
    this.workDir = workDir
    this.backend = backend
    this.now = now
    this.createdAt = createdAt
    this._lastActiveAt = createdAt

    backend.onLine((line) => {
      this.touch()
      for (const listener of this.lineListeners) listener(line)
    })
    backend.onExit((info) => this.handleExit(info))
  }

  get status(): SessionState {
    return this._status
  }

  get lastActiveAt(): number {
    return this._lastActiveAt
  }

  get pid(): number | undefined {
    return this.backend.pid
  }

  touch(): void {
    this._lastActiveAt = this.now()
  }

  attach(): void {
    if (this._status === 'detached') this._status = 'running'
  }

  detach(): void {
    if (this._status === 'running') this._status = 'detached'
  }

  writeStdin(data: string): void {
    this.backend.writeStdin(data)
    this.touch()
  }

  addLineListener(cb: (line: string) => void): () => void {
    this.lineListeners.add(cb)
    return () => this.lineListeners.delete(cb)
  }

  addExitListener(cb: (info: BackendExitInfo) => void): () => void {
    this.exitListeners.add(cb)
    if (this.exitInfo) cb(this.exitInfo)
    return () => this.exitListeners.delete(cb)
  }

  getStderrTail(): string {
    return this.backend.getStderrTail()
  }

  kill(): void {
    this.backend.kill()
  }

  /** Resolves once the backend process exits (or immediately if it already has). */
  waitForExit(timeoutMs: number): Promise<void> {
    if (this.exitInfo) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.doneResolvers.delete(finish)
        // The `settled` guard above makes this the only resolution; the linter can't see it.
        // oxlint-disable-next-line eslint-plugin-promise/no-multiple-resolved
        resolve()
      }
      this.doneResolvers.add(finish)
      timer = setTimeout(finish, Math.max(0, timeoutMs))
    })
  }

  private handleExit(info: BackendExitInfo): void {
    this.exitInfo = info
    if (this._status !== 'stopped') this._status = 'stopped'
    for (const listener of this.exitListeners) listener(info)
    // Snapshot: each `finish` deletes itself from `doneResolvers`.
    for (const resolve of Array.from(this.doneResolvers)) resolve()
    this.doneResolvers.clear()
  }
}

export class SessionManager {
  private readonly backend: SessionBackend
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly now: () => number
  private readonly generateId: () => string
  private readonly maxSessions: number
  private readonly idleTimeoutMs: number
  private readonly workspace: string | undefined
  private readonly destroyGraceMs: number
  private sweeper: ReturnType<typeof setInterval> | undefined

  constructor(backend: SessionBackend, options: SessionManagerOptions = {}) {
    this.backend = backend
    this.now = options.now ?? (() => Date.now())
    this.generateId = options.generateId ?? (() => randomUUID())
    this.maxSessions = options.maxSessions ?? 0
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0
    this.workspace = options.workspace
    this.destroyGraceMs = options.destroyGraceMs ?? 1000

    const interval = options.sweepIntervalMs ?? (this.idleTimeoutMs > 0 ? Math.min(this.idleTimeoutMs, 60_000) : 0)
    if (interval > 0) {
      this.sweeper = setInterval(() => this.sweep(), interval)
      this.sweeper.unref?.()
    }
  }

  createSession(opts: CreateSessionOptions = {}): ManagedSession {
    if (this.maxSessions > 0 && this.sessions.size >= this.maxSessions) {
      throw new SessionLimitError(this.maxSessions)
    }

    const id = this.generateId()
    const workDir = opts.cwd ?? this.workspace ?? process.cwd()
    const backend = this.backend.spawn({
      sessionId: id,
      cwd: workDir,
      permissionMode: opts.permissionMode,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? false,
    })

    const session = new ManagedSession({ id, workDir, backend, now: this.now, createdAt: this.now() })
    this.sessions.set(id, session)
    // Remove from the registry as soon as the child exits so lists stay live.
    session.addExitListener(() => this.sessions.delete(id))
    return session
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      workDir: session.workDir,
      process: null,
    }))
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    session.kill()
    await session.waitForExit(this.destroyGraceMs)
  }

  async destroyAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    for (const session of all) session.kill()
    await Promise.all(all.map((session) => session.waitForExit(this.destroyGraceMs)))
  }

  /** Reap sessions that have been idle longer than `idleTimeoutMs`. Returns the count. */
  sweep(now: number = this.now()): number {
    if (this.idleTimeoutMs <= 0) return 0
    let destroyed = 0
    for (const [id, session] of this.sessions) {
      if (session.status === 'stopped') {
        this.sessions.delete(id)
        continue
      }
      if (now - session.lastActiveAt >= this.idleTimeoutMs) {
        this.sessions.delete(id)
        session.kill()
        destroyed++
      }
    }
    return destroyed
  }

  stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = undefined
    }
  }
}
