import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'test-api-key'

import type { AppEnv } from '@/auth/context'
import { encodeWebSocketAuthProtocol } from '@/auth/context'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import sessionIngress, {
  decodeSessionIngressWsMessage,
  handleSessionIngressWsPayload,
  websocket as sessionIngressWebsocket,
} from '@/routes/v1/session-ingress'
import { getAllEventBuses, getEventBus, publishSessionEvent, removeEventBus } from '@/transport/event-bus'

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/v2/session_ingress', sessionIngress)
  return app
}

const AUTH_HEADERS = {
  Authorization: 'Bearer test-api-key',
  'Content-Type': 'application/json',
}

async function seedRepos(): Promise<Repositories> {
  const repos = await createTestRepositories()
  await repos.users.create({ username: 'admin', passwordHash: 'hash', role: 'admin' })
  return repos
}

/** Connect, complete the upgrade, and resolve the WS close code (rejects on timeout). */
async function closeCodeFor(url: string, protocols: string[]): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for close')), 2000)
    const ws = new WebSocket(url, protocols)
    ws.addEventListener('close', (event) => {
      clearTimeout(timeout)
      resolve(event.code)
    })
    ws.addEventListener('error', () => {
      // A failed upgrade also fires here; close/timeout decides the result.
    })
  })
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('timed out waiting for condition')
}

let repos: Repositories
let app: Hono<AppEnv>

beforeEach(async () => {
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  repos = await seedRepos()
  app = createApp(repos)
})

afterEach(() => {
  for (const [key] of getAllEventBuses()) removeEventBus(key)
})

describe('POST /v2/session_ingress/session/:id/events', () => {
  test('ingests events with an API key', async () => {
    const session = await repos.sessions.create({})

    const res = await app.request(`/v2/session_ingress/session/${session.id}/events`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ events: [{ type: 'assistant', content: 'response' }] }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    const stored = await repos.events.listSince(session.id, 0, 10)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.type).toBe('assistant')
    expect(stored[0]?.direction).toBe('inbound')
  })

  test('persists a replayed message once across batch replays', async () => {
    // The hybrid transport replays its write buffer on every reconnect; the same
    // assistant message (same uuid) must not be stored again.
    const session = await repos.sessions.create({})
    const event = { type: 'assistant', uuid: 'a_replay', message: { role: 'assistant', content: 'history' } }

    const post = (body: unknown) =>
      app.request(`/v2/session_ingress/session/${session.id}/events`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(body),
      })

    expect((await post({ events: [event] })).status).toBe(200)
    expect((await post({ events: [event] })).status).toBe(200)

    const stored = await repos.events.listSince(session.id, 0, 10)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.messageUuid).toBe('a_replay')
  })

  test('does not persist replay acknowledgements marked isReplay', async () => {
    const session = await repos.sessions.create({})
    const res = await app.request(`/v2/session_ingress/session/${session.id}/events`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        events: [{ type: 'user', uuid: 'u_ack', isReplay: true, message: { role: 'user', content: 'done' } }],
      }),
    })

    expect(res.status).toBe(200)
    expect(await repos.events.listSince(session.id, 0, 10)).toHaveLength(0)
  })

  test('rejects requests without credentials', async () => {
    const session = await repos.sessions.create({})
    const res = await app.request(`/v2/session_ingress/session/${session.id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })
    expect(res.status).toBe(401)
  })

  test('returns 404 for an unknown session', async () => {
    const res = await app.request('/v2/session_ingress/session/nope/events', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ events: [{ type: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(404)
  })

  test('resolves compatible web session ids to the canonical row', async () => {
    const session = await repos.sessions.create({})
    const compatId = `session_${session.id.slice('cse_'.length)}`

    const res = await app.request(`/v2/session_ingress/session/${compatId}/events`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ events: [{ type: 'assistant', message: { role: 'assistant', content: 'compat ok' } }] }),
    })

    expect(res.status).toBe(200)
    const stored = await repos.events.listSince(session.id, 0, 10)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.type).toBe('assistant')
  })
})

describe('GET /v2/session_ingress/ws/:id', () => {
  test('accepts a small payload and persists the inbound event', async () => {
    const session = await repos.sessions.create({})
    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket: { ...sessionIngressWebsocket, idleTimeout: 30 },
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out')), 2000)
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v2/session_ingress/ws/${session.id}`, [
          encodeWebSocketAuthProtocol('test-api-key'),
        ])
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) + '\n')
        })
        ws.addEventListener('error', () => {
          clearTimeout(timeout)
          reject(new Error('websocket connection failed'))
        })
        void (async () => {
          try {
            await waitFor(async () =>
              (await repos.events.listSince(session.id, 0, 10)).some((event) => event.type === 'user'),
            )
            clearTimeout(timeout)
            ws.close()
            resolve()
          } catch (error) {
            reject(error)
          }
        })()
      })

      const stored = await repos.events.listSince(session.id, 0, 10)
      expect(stored).toHaveLength(1)
      expect(stored[0]?.type).toBe('user')
      expect(stored[0]?.direction).toBe('inbound')
    } finally {
      await server.stop(true)
    }
  })

  test('replays durable outbound events through a compatible session id', async () => {
    const session = await repos.sessions.create({})
    await publishSessionEvent(
      repos,
      getEventBus(session.id),
      session.id,
      'user',
      { content: 'compat ws replay' },
      'outbound',
    )
    const compatId = `session_${session.id.slice('cse_'.length)}`

    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket: { ...sessionIngressWebsocket, idleTimeout: 30 },
    })

    try {
      const payload = await new Promise<{ type: string; message: { content: string } }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out')), 2000)
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v2/session_ingress/ws/${compatId}`, [
          encodeWebSocketAuthProtocol('test-api-key'),
        ])
        ws.addEventListener('message', (event) => {
          const data = typeof event.data === 'string' ? event.data : String(event.data)
          if (!data.includes('"type":"user"')) return
          clearTimeout(timeout)
          ws.close()
          resolve(JSON.parse(data) as { type: string; message: { content: string } })
        })
        ws.addEventListener('error', () => {
          clearTimeout(timeout)
          reject(new Error('compat websocket connection failed'))
        })
      })

      expect(payload.type).toBe('user')
      expect(payload.message.content).toBe('compat ws replay')
    } finally {
      await server.stop(true)
    }
  })

  test('closes with 4001 after upgrading when the session does not exist', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket: { ...sessionIngressWebsocket, idleTimeout: 30 },
    })

    try {
      const code = await closeCodeFor(`ws://127.0.0.1:${server.port}/v2/session_ingress/ws/cse_missing`, [
        encodeWebSocketAuthProtocol('test-api-key'),
      ])
      expect(code).toBe(4001)
    } finally {
      await server.stop(true)
    }
  })

  test('closes with 4003 after upgrading when credentials are invalid', async () => {
    const session = await repos.sessions.create({})
    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket: { ...sessionIngressWebsocket, idleTimeout: 30 },
    })

    try {
      const code = await closeCodeFor(`ws://127.0.0.1:${server.port}/v2/session_ingress/ws/${session.id}`, [
        encodeWebSocketAuthProtocol('wrong-key'),
      ])
      expect(code).toBe(4003)
    } finally {
      await server.stop(true)
    }
  })

  test('closes an 11MB payload with 1009', () => {
    const closes: Array<{ code?: number; reason?: string }> = []
    const handled = handleSessionIngressWsPayload(
      repos,
      { close: (code?: number, reason?: string) => closes.push({ code, reason }) } as never,
      'session_large',
      'x'.repeat(11 * 1024 * 1024),
    )

    expect(handled).toBe(false)
    expect(closes).toEqual([{ code: 1009, reason: 'message too large' }])
  })

  test('rejects unsupported payload types with 1003', () => {
    const closes: Array<{ code?: number; reason?: string }> = []
    const handled = handleSessionIngressWsPayload(
      repos,
      { close: (code?: number, reason?: string) => closes.push({ code, reason }) } as never,
      'session_bad',
      { data: 'bad' },
    )

    expect(decodeSessionIngressWsMessage({ data: 'bad' }).ok).toBe(false)
    expect(handled).toBe(false)
    expect(closes).toEqual([{ code: 1003, reason: 'unsupported message payload' }])
  })
})
