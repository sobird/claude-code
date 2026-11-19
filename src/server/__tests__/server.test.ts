import { describe, expect, test } from 'bun:test'

import { startServer } from '../server.js'
import {
  type BackendExitInfo,
  type BackendSession,
  type BackendSpawnOpts,
  SessionManager,
  type SessionBackend,
} from '../sessionManager.js'

class FakeBackendSession implements BackendSession {
  pid = 1000
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

const TOKEN = 'test-token'

function setup(overrides: { maxSessions?: number } = {}) {
  const spawns: Array<{ opts: BackendSpawnOpts; session: FakeBackendSession }> = []
  const backend: SessionBackend = {
    spawn(opts) {
      const session = new FakeBackendSession()
      spawns.push({ opts, session })
      return session
    },
  }
  let idCounter = 0
  const manager = new SessionManager(backend, {
    generateId: () => `sess-${++idCounter}`,
    sweepIntervalMs: 0,
    destroyGraceMs: 0,
    workspace: '/ws-default',
    ...overrides,
  })
  const server = startServer({ port: 0, host: '127.0.0.1', authToken: TOKEN }, manager)
  const base = `http://127.0.0.1:${server.port}`
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  return {
    server,
    manager,
    spawns,
    base,
    auth,
    post: (body: unknown, opts: { authed?: boolean } = {}) =>
      fetch(`${base}/sessions`, {
        method: 'POST',
        headers: opts.authed === false ? { 'content-type': 'application/json' } : auth,
        body: JSON.stringify(body),
      }),
    close: async () => {
      server.stop(true)
      manager.stopSweeper()
      await manager.destroyAll()
    },
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

/** Open a WS to `url` with auth, collecting newline-separated frames into `lines`. */
function connectWs(url: string): Promise<{ ws: WebSocket; lines: string[] }> {
  const ws = new WebSocket(url, {
    headers: { authorization: `Bearer ${TOKEN}` },
  } as unknown as string[])
  const lines: string[] = []
  ws.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? event.data : ''
    for (const line of data.split('\n')) if (line.trim()) lines.push(line)
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ ws, lines }))
    ws.addEventListener('error', () => reject(new Error('ws error')))
    setTimeout(() => reject(new Error('ws connect timed out')), 3000)
  })
}

describe('startServer', () => {
  test('rejects unauthenticated session creation and listing', async () => {
    const ctx = setup()
    try {
      const create = await ctx.post({ cwd: '/x' }, { authed: false })
      expect(create.status).toBe(401)
      const list = await fetch(`${ctx.base}/sessions`, { headers: { authorization: 'Bearer wrong' } })
      expect(list.status).toBe(401)
    } finally {
      await ctx.close()
    }
  })

  test('creates a session and returns ws_url + work_dir', async () => {
    const ctx = setup()
    try {
      const resp = await ctx.post({ cwd: '/explicit', dangerously_skip_permissions: true })
      expect(resp.status).toBe(200)
      const data = (await resp.json()) as { session_id: string; ws_url: string; work_dir: string }
      expect(data.session_id).toBe('sess-1')
      expect(data.work_dir).toBe('/explicit')
      expect(data.ws_url).toBe(`ws://127.0.0.1:${ctx.server.port}/sessions/sess-1/ws`)
      expect(ctx.spawns[0].opts).toMatchObject({ cwd: '/explicit', dangerouslySkipPermissions: true })
    } finally {
      await ctx.close()
    }
  })

  test('falls back to the default workspace cwd when none is given', async () => {
    const ctx = setup()
    try {
      const data = (await (await ctx.post({})).json()) as { work_dir: string }
      expect(data.work_dir).toBe('/ws-default')
    } finally {
      await ctx.close()
    }
  })

  test('lists, fetches, and deletes sessions', async () => {
    const ctx = setup()
    try {
      const { session_id } = (await (await ctx.post({ cwd: '/a' })).json()) as { session_id: string }

      const list = (await (await fetch(`${ctx.base}/sessions`, { headers: ctx.auth })).json()) as {
        sessions: Array<{ id: string }>
      }
      expect(list.sessions.map((s) => s.id)).toEqual([session_id])

      const one = await fetch(`${ctx.base}/sessions/${session_id}`, { headers: ctx.auth })
      expect(one.status).toBe(200)

      const del = await fetch(`${ctx.base}/sessions/${session_id}`, { method: 'DELETE', headers: ctx.auth })
      expect(del.status).toBe(204)

      const gone = await fetch(`${ctx.base}/sessions/${session_id}`, { headers: ctx.auth })
      expect(gone.status).toBe(404)
    } finally {
      await ctx.close()
    }
  })

  test('enforces maxSessions with a 429', async () => {
    const ctx = setup({ maxSessions: 1 })
    try {
      expect((await ctx.post({})).status).toBe(200)
      expect((await ctx.post({})).status).toBe(429)
    } finally {
      await ctx.close()
    }
  })

  test('bridges stdin/stdout frames over the websocket, replaying buffered lines', async () => {
    const ctx = setup()
    try {
      const { session_id, ws_url } = (await (await ctx.post({ cwd: '/x' })).json()) as {
        session_id: string
        ws_url: string
      }
      const child = ctx.spawns[0].session

      // Emitted before the client connects — must be buffered and replayed.
      child.emitLine('{"type":"system","subtype":"init"}')

      const { ws, lines } = await connectWs(ws_url)
      await waitFor(() => lines.includes('{"type":"system","subtype":"init"}'))

      // Client sends a user turn without a trailing newline; server must append one.
      const frame = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hi' },
        parent_tool_use_id: null,
        session_id: '',
      })
      ws.send(frame)
      await waitFor(() => child.written.length >= 1)
      expect(child.written[0]).toBe(`${frame}\n`)

      // Child output is streamed live to an attached client.
      child.emitLine('{"type":"assistant"}')
      await waitFor(() => lines.includes('{"type":"assistant"}'))

      // Child exit tears the socket down so the client sees a disconnect.
      child.emitExit()
      await waitFor(() => ws.readyState === WebSocket.CLOSED)
      expect(ctx.manager.getSession(session_id)).toBeUndefined()
    } finally {
      await ctx.close()
    }
  })

  test('rejects a websocket upgrade without a valid token', async () => {
    const ctx = setup()
    try {
      const { ws_url } = (await (await ctx.post({})).json()) as { ws_url: string }
      const ws = new WebSocket(ws_url)
      const outcome = await new Promise<'open' | 'closed'>((resolve) => {
        ws.addEventListener('open', () => resolve('open'))
        ws.addEventListener('close', () => resolve('closed'))
        ws.addEventListener('error', () => resolve('closed'))
        setTimeout(() => resolve('closed'), 1000)
      })
      expect(outcome).toBe('closed')
    } finally {
      await ctx.close()
    }
  })
})
