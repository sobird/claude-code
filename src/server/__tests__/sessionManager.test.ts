import { describe, expect, test } from 'bun:test'

import {
  type BackendExitInfo,
  type BackendSession,
  type BackendSpawnOpts,
  SessionLimitError,
  SessionManager,
  type SessionBackend,
  type SessionManagerOptions,
} from '../sessionManager.js'

class FakeBackendSession implements BackendSession {
  pid = 4242
  written: string[] = []
  killed = false
  private lineCb?: (line: string) => void
  private exitCb?: (info: BackendExitInfo) => void

  writeStdin(data: string): void {
    this.written.push(data)
  }
  onLine(cb: (line: string) => void): void {
    this.lineCb = cb
  }
  onExit(cb: (info: BackendExitInfo) => void): void {
    this.exitCb = cb
  }
  kill(): void {
    this.killed = true
  }
  getStderrTail(): string {
    return ''
  }

  emitLine(line: string): void {
    this.lineCb?.(line)
  }
  emitExit(info: BackendExitInfo = { code: 0, signal: null }): void {
    this.exitCb?.(info)
  }
}

function makeBackend() {
  const spawns: Array<{ opts: BackendSpawnOpts; session: FakeBackendSession }> = []
  const backend: SessionBackend = {
    spawn(opts) {
      const session = new FakeBackendSession()
      spawns.push({ opts, session })
      return session
    },
  }
  return { backend, spawns }
}

function makeManager(overrides: Partial<SessionManagerOptions> = {}) {
  const { backend, spawns } = makeBackend()
  let idCounter = 0
  let clock = 1_000
  const manager = new SessionManager(backend, {
    now: () => clock,
    generateId: () => `sess-${++idCounter}`,
    sweepIntervalMs: 0,
    destroyGraceMs: 0,
    ...overrides,
  })
  return {
    manager,
    spawns,
    advance: (ms: number) => {
      clock += ms
    },
    now: () => clock,
  }
}

describe('SessionManager', () => {
  test('creates a session, forwards spawn opts, and lists it', () => {
    const { manager, spawns } = makeManager({ workspace: '/workspace' })
    const session = manager.createSession({ dangerouslySkipPermissions: false, permissionMode: 'plan' })

    expect(session.id).toBe('sess-1')
    expect(session.workDir).toBe('/workspace')
    expect(session.status).toBe('running')
    expect(spawns).toHaveLength(1)
    expect(spawns[0].opts).toMatchObject({
      sessionId: 'sess-1',
      cwd: '/workspace',
      permissionMode: 'plan',
      dangerouslySkipPermissions: false,
    })

    expect(manager.getSession('sess-1')).toBe(session)
    const list = manager.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'sess-1', status: 'running', workDir: '/workspace' })
  })

  test('uses the request cwd over the workspace default', () => {
    const { manager, spawns } = makeManager({ workspace: '/workspace' })
    const session = manager.createSession({ cwd: '/explicit' })
    expect(session.workDir).toBe('/explicit')
    expect(spawns[0].opts.cwd).toBe('/explicit')
  })

  test('enforces maxSessions but treats 0 as unlimited', () => {
    const { manager } = makeManager({ maxSessions: 1 })
    manager.createSession({})
    expect(() => manager.createSession({})).toThrow(SessionLimitError)

    const unlimited = makeManager({ maxSessions: 0 }).manager
    unlimited.createSession({})
    unlimited.createSession({})
    expect(unlimited.listSessions()).toHaveLength(2)
  })

  test('getting a session that was destroyed returns undefined after destroy', async () => {
    const { manager, spawns } = makeManager()
    const session = manager.createSession({})
    await manager.destroySession(session.id)
    expect(spawns[0].session.killed).toBe(true)
    expect(manager.getSession(session.id)).toBeUndefined()
    expect(manager.listSessions()).toHaveLength(0)
  })

  test('destroyAll stops every session and is idempotent', async () => {
    const { manager, spawns } = makeManager()
    manager.createSession({})
    manager.createSession({})
    await manager.destroyAll()
    expect(spawns.every((s) => s.session.killed)).toBe(true)
    expect(manager.listSessions()).toHaveLength(0)
    await manager.destroyAll()
  })

  test('marks a session stopped and notifies exit listeners on backend exit', () => {
    const { manager, spawns } = makeManager()
    const session = manager.createSession({})
    const exits: BackendExitInfo[] = []
    session.addExitListener((info) => exits.push(info))

    spawns[0].session.emitExit({ code: 1, signal: null })

    expect(exits).toEqual([{ code: 1, signal: null }])
    expect(session.status).toBe('stopped')
    expect(manager.listSessions()).toHaveLength(0)
  })

  test('fans lines out to every subscriber and honours unsubscribe', () => {
    const { manager, spawns } = makeManager()
    const session = manager.createSession({})
    const a: string[] = []
    const b: string[] = []
    const offA = session.addLineListener((line) => a.push(line))
    session.addLineListener((line) => b.push(line))

    spawns[0].session.emitLine('one')
    offA()
    spawns[0].session.emitLine('two')

    expect(a).toEqual(['one'])
    expect(b).toEqual(['one', 'two'])
  })

  test('writeStdin forwards to the backend and updates lastActiveAt', () => {
    const { manager, spawns, advance, now } = makeManager()
    const session = manager.createSession({})
    const before = session.lastActiveAt
    advance(5_000)
    session.writeStdin('{"type":"user"}\n')
    expect(spawns[0].session.written).toEqual(['{"type":"user"}\n'])
    expect(session.lastActiveAt).toBe(now())
    expect(session.lastActiveAt).toBeGreaterThan(before)
  })

  test('attach/detach toggles running <-> detached', () => {
    const { manager } = makeManager()
    const session = manager.createSession({})
    expect(session.status).toBe('running')
    session.detach()
    expect(session.status).toBe('detached')
    session.attach()
    expect(session.status).toBe('running')
  })

  test('sweep destroys sessions idle past idleTimeoutMs only', async () => {
    const { manager, spawns, advance } = makeManager({ idleTimeoutMs: 10_000 })
    const idle = manager.createSession({})
    const active = manager.createSession({})

    advance(11_000)
    active.touch() // recent activity

    const destroyed = manager.sweep()

    expect(destroyed).toBe(1)
    expect(spawns[0].session.killed).toBe(true)
    expect(spawns[1].session.killed).toBe(false)
    expect(manager.getSession(idle.id)).toBeUndefined()
    expect(manager.getSession(active.id)).toBe(active)
    await manager.destroyAll()
  })

  test('sweep is a no-op when idle timeout is disabled', () => {
    const { manager, advance } = makeManager({ idleTimeoutMs: 0 })
    manager.createSession({})
    advance(10_000_000)
    expect(manager.sweep()).toBe(0)
    expect(manager.listSessions()).toHaveLength(1)
  })

  test('exposes the backend stderr tail and pid', () => {
    const { manager } = makeManager()
    const session = manager.createSession({})
    expect(session.pid).toBe(4242)
    expect(session.getStderrTail()).toBe('')
  })
})
