import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'
import type { WSContext } from 'hono/ws'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'legacy-key'

import { generateApiKey } from '../../auth/api-key.js'
import type { AppEnv, AuthUser } from '../../auth/context.js'
import { encodeWebSocketAuthProtocol } from '../../auth/context.js'
import { signAccessToken } from '../../auth/tokens.js'
import type { UserRecord } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import acpRoutes, { websocket as acpWebsocket } from '../../routes/acp/index.js'
import { handleRelayOpen } from '../acp-relay-handler.js'
import { handleAcpWsClose, handleAcpWsMessage, handleAcpWsOpen } from '../acp-ws-handler.js'
import { getAllAcpEventBuses, getAcpEventBus, removeAcpEventBus } from '../event-bus.js'

interface MockWs {
  readyState: number
  sent: string[]
  closes: Array<{ code?: number; reason?: string }>
  send(data: string): void
  close(code?: number, reason?: string): void
}

function createMockWs(readyState = 1): MockWs {
  return {
    readyState,
    sent: [],
    closes: [],
    send(data) {
      this.sent.push(data)
    },
    close(code, reason) {
      this.closes.push({ code, reason })
      this.readyState = 3
    },
  }
}

function asWs(ws: MockWs): WSContext {
  return ws as unknown as WSContext
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('timed out waiting for condition')
}

interface Seed {
  repos: Repositories
  admin: UserRecord
  member: UserRecord
  other: UserRecord
  adminUser: AuthUser
  memberUser: AuthUser
  otherUser: AuthUser
  adminToken: string
  memberToken: string
  otherToken: string
  memberApiKey: string
}

async function seed(): Promise<Seed> {
  const repos = createMemoryRepositories()
  const admin = await repos.users.create({ username: 'admin', passwordHash: 'hash', role: 'admin' })
  const member = await repos.users.create({ username: 'member', passwordHash: 'hash', role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash: 'hash', role: 'member' })

  const key = generateApiKey()
  await repos.apiKeys.create({ userId: member.id, name: 'member key', prefix: key.prefix, hash: key.hash })

  const toUser = (user: UserRecord): AuthUser => ({ id: user.id, username: user.username, role: user.role })
  return {
    repos,
    admin,
    member,
    other,
    adminUser: toUser(admin),
    memberUser: toUser(member),
    otherUser: toUser(other),
    adminToken: await signAccessToken(toUser(admin)),
    memberToken: await signAccessToken(toUser(member)),
    otherToken: await signAccessToken(toUser(other)),
    memberApiKey: key.raw,
  }
}

function createApp(repos: Repositories): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/acp', acpRoutes)
  return app
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

async function resJson(res: Response): Promise<unknown> {
  return res.json()
}

let s: Seed
let app: Hono<AppEnv>

beforeEach(async () => {
  for (const [key] of getAllAcpEventBuses()) removeAcpEventBus(key)
  s = await seed()
  app = createApp(s.repos)
})

afterEach(() => {
  for (const [key] of getAllAcpEventBuses()) removeAcpEventBus(key)
})

describe('GET /acp/agents', () => {
  test('requires credentials', async () => {
    const res = await app.request('/acp/agents')
    expect(res.status).toBe(401)
  })

  test('accepts a member API key and returns only the caller environments', async () => {
    const mine = await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-member',
      machineName: 'mine',
    })
    const offline = await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-member',
      machineName: 'offline',
    })
    await s.repos.environments.update(offline.id, { status: 'offline' })
    await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', machineName: 'foreign' })
    await s.repos.environments.create({ ownerUserId: s.member.id, workerType: 'claude_code' })

    const res = await app.request('/acp/agents', { headers: bearer(s.memberApiKey) })
    expect(res.status).toBe(200)
    const body = (await resJson(res)) as Array<Record<string, unknown>>
    const ids = body.map((agent) => agent.id)
    expect(ids).toContain(mine.id)
    expect(ids).toContain(offline.id)
    expect(ids).toHaveLength(2)
    expect(body.find((agent) => agent.id === offline.id)?.status).toBe('offline')
    expect(body.find((agent) => agent.id === mine.id)?.agent_name).toBe('mine')
  })

  test('accepts an access token', async () => {
    await s.repos.environments.create({ ownerUserId: s.member.id, workerType: 'acp', machineName: 'mine' })

    const res = await app.request('/acp/agents', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect(((await resJson(res)) as unknown[]).length).toBe(1)
  })

  test('admins see every agent', async () => {
    await s.repos.environments.create({ ownerUserId: s.member.id, workerType: 'acp', machineName: 'mine' })
    await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', machineName: 'foreign' })

    const res = await app.request('/acp/agents', { headers: bearer(s.adminToken) })
    expect(res.status).toBe(200)
    expect(((await resJson(res)) as unknown[]).length).toBe(2)
  })
})

describe('GET /acp/channel-groups', () => {
  test('lists only groups built from the caller visible agents', async () => {
    await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-member',
      machineName: 'mine',
    })
    await s.repos.environments.create({
      ownerUserId: s.other.id,
      workerType: 'acp',
      bridgeId: 'group-other',
      machineName: 'foreign',
    })

    const res = await app.request('/acp/channel-groups', { headers: bearer(s.memberToken) })
    const body = (await resJson(res)) as Array<{ channel_group_id: string; member_count: number }>
    expect(body.map((group) => group.channel_group_id)).toEqual(['group-member'])
    expect(body[0]?.member_count).toBe(1)
  })

  test('detail 404s for a group the caller cannot see', async () => {
    await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', bridgeId: 'group-other' })

    const res = await app.request('/acp/channel-groups/group-other', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(404)

    const adminRes = await app.request('/acp/channel-groups/group-other', { headers: bearer(s.adminToken) })
    expect(adminRes.status).toBe(200)
  })

  test('detail returns visible members', async () => {
    const mine = await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-member',
      machineName: 'mine',
    })

    const res = await app.request('/acp/channel-groups/group-member', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    const body = (await resJson(res)) as { channel_group_id: string; members: Array<{ id: string }> }
    expect(body.channel_group_id).toBe('group-member')
    expect(body.members.map((member) => member.id)).toEqual([mine.id])
  })
})

describe('GET /acp/channel-groups/:id/events', () => {
  test('404s for a non-visible group', async () => {
    await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', bridgeId: 'group-other' })

    const res = await app.request('/acp/channel-groups/group-other/events', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(404)
  })

  test('replays retained in-memory events from the cursor', async () => {
    await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-member',
      machineName: 'mine',
    })
    const bus = getAcpEventBus('group-member')
    bus.publish({ id: 'e1', sessionId: 'group-member', type: 'first', payload: { n: 1 }, direction: 'outbound' })
    bus.publish({ id: 'e2', sessionId: 'group-member', type: 'second', payload: { n: 2 }, direction: 'outbound' })

    const res = await app.request('/acp/channel-groups/group-member/events?from_sequence_num=1', {
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const reader = res.body?.getReader()
    const chunk = await reader?.read()
    const text = new TextDecoder().decode(chunk?.value)
    expect(text).toContain('"type":"second"')
    expect(text).toContain('"seqNum":2')
    expect(text).not.toContain('"type":"first"')
    await reader?.cancel()
  })
})

describe('ACP agent WebSocket handlers', () => {
  test('identify by a non-owner is refused without binding', async () => {
    const foreign = await s.repos.environments.create({
      ownerUserId: s.other.id,
      workerType: 'acp',
      bridgeId: 'group-other',
      machineName: 'foreign',
    })
    const ws = createMockWs()

    handleAcpWsOpen(s.repos, asWs(ws), 'ws-identify', s.memberUser)
    handleAcpWsMessage(
      s.repos,
      asWs(ws),
      'ws-identify',
      `${JSON.stringify({ type: 'identify', agent_id: foreign.id })}\n`,
    )
    await waitFor(() => ws.sent.some((line) => line.includes('"error"')))

    expect(ws.sent.join('')).toContain('Agent not found')
    expect(ws.sent.join('')).not.toContain('identified')

    // Still unbound: an ordinary message is rejected with the registration prompt.
    ws.sent.length = 0
    handleAcpWsMessage(s.repos, asWs(ws), 'ws-identify', `${JSON.stringify({ type: 'message', content: 'hi' })}\n`)
    expect(ws.sent.join('')).toContain('Not registered')

    handleAcpWsClose(s.repos, asWs(ws), 'ws-identify')
  })

  test('legacy register creates an acp environment owned by the authenticated user', async () => {
    const ws = createMockWs()

    handleAcpWsOpen(s.repos, asWs(ws), 'ws-register', s.memberUser)
    handleAcpWsMessage(
      s.repos,
      asWs(ws),
      'ws-register',
      `${JSON.stringify({ type: 'register', agent_name: 'agent-one', channel_group_id: 'group-reg' })}\n`,
    )
    await waitFor(() => ws.sent.some((line) => line.includes('"registered"')))

    const registered = ws.sent.find((line) => line.includes('"registered"'))
    const parsed = JSON.parse(registered ?? '{}') as { agent_id?: string }
    expect(typeof parsed.agent_id).toBe('string')

    const env = await s.repos.environments.getById(parsed.agent_id ?? '')
    expect(env?.workerType).toBe('acp')
    expect(env?.ownerUserId).toBe(s.member.id)
    expect(env?.bridgeId).toBe('group-reg')
    expect(env?.machineName).toBe('agent-one')
    expect(env?.status).toBe('active')

    handleAcpWsClose(s.repos, asWs(ws), 'ws-register')
  })

  test('two identify frames in one payload bind exactly once', async () => {
    const env = await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-dup-identify',
    })
    const ws = createMockWs()

    handleAcpWsOpen(s.repos, asWs(ws), 'ws-dup-identify', s.memberUser)
    const frame = JSON.stringify({ type: 'identify', agent_id: env.id })
    handleAcpWsMessage(s.repos, asWs(ws), 'ws-dup-identify', `${frame}\n${frame}\n`)
    await waitFor(() => ws.sent.some((line) => line.includes('"identified"')))
    await Bun.sleep(20) // let the second (in-flight-guarded) frame settle

    const output = ws.sent.join('')
    expect(ws.sent.filter((line) => line.includes('"identified"'))).toHaveLength(1)
    expect(output).toContain('Already identified')
    // Exactly one bus subscription: a second bind would leak the earlier subscriber.
    expect(getAcpEventBus('group-dup-identify').subscriberCount()).toBe(1)

    const active = await s.repos.environments.listActive({ ownerUserId: s.member.id })
    expect(active.filter((record) => record.id === env.id)).toHaveLength(1)

    handleAcpWsClose(s.repos, asWs(ws), 'ws-dup-identify')
  })

  test('a failed identify can be retried on the same connection', async () => {
    const env = await s.repos.environments.create({
      ownerUserId: s.member.id,
      workerType: 'acp',
      bridgeId: 'group-retry',
    })
    const ws = createMockWs()

    handleAcpWsOpen(s.repos, asWs(ws), 'ws-retry', s.memberUser)
    handleAcpWsMessage(
      s.repos,
      asWs(ws),
      'ws-retry',
      `${JSON.stringify({ type: 'identify', agent_id: 'env_missing' })}\n`,
    )
    await waitFor(() => ws.sent.some((line) => line.includes('Agent not found')))

    ws.sent.length = 0
    handleAcpWsMessage(s.repos, asWs(ws), 'ws-retry', `${JSON.stringify({ type: 'identify', agent_id: env.id })}\n`)
    await waitFor(() => ws.sent.some((line) => line.includes('"identified"')))

    expect(ws.sent.join('')).toContain(env.id)
    expect(getAcpEventBus('group-retry').subscriberCount()).toBe(1)

    handleAcpWsClose(s.repos, asWs(ws), 'ws-retry')
  })

  test('two register frames in one payload create a single environment', async () => {
    const ws = createMockWs()

    handleAcpWsOpen(s.repos, asWs(ws), 'ws-dup-register', s.memberUser)
    const frame = JSON.stringify({ type: 'register', agent_name: 'dup', channel_group_id: 'group-dup-register' })
    handleAcpWsMessage(s.repos, asWs(ws), 'ws-dup-register', `${frame}\n${frame}\n`)
    await waitFor(() => ws.sent.some((line) => line.includes('"registered"')))
    await Bun.sleep(20)

    expect(ws.sent.filter((line) => line.includes('"registered"'))).toHaveLength(1)
    expect(ws.sent.join('')).toContain('Already registered')
    expect(getAcpEventBus('group-dup-register').subscriberCount()).toBe(1)

    const agents = await s.repos.environments.listByWorkerType('acp', { ownerUserId: s.member.id })
    expect(agents).toHaveLength(1)

    handleAcpWsClose(s.repos, asWs(ws), 'ws-dup-register')
  })
})

describe('ACP relay ownership', () => {
  test('closes 4003 for a non-owner', async () => {
    const foreign = await s.repos.environments.create({
      ownerUserId: s.other.id,
      workerType: 'acp',
      bridgeId: 'group-other',
    })
    const ws = createMockWs()

    await handleRelayOpen(s.repos, asWs(ws), 'relay-non-owner', foreign.id, s.memberUser)
    expect(ws.closes).toEqual([{ code: 4003, reason: 'unauthorized' }])
  })

  test('closes 4004 for an owned but offline agent', async () => {
    const mine = await s.repos.environments.create({ ownerUserId: s.member.id, workerType: 'acp', bridgeId: 'g' })
    const ws = createMockWs()

    await handleRelayOpen(s.repos, asWs(ws), 'relay-offline', mine.id, s.memberUser)
    expect(ws.closes).toEqual([{ code: 4004, reason: 'agent not found' }])
  })

  test('admins may relay to an owned offline agent (4004, not 4003)', async () => {
    const foreign = await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', bridgeId: 'g' })
    const ws = createMockWs()

    await handleRelayOpen(s.repos, asWs(ws), 'relay-admin', foreign.id, s.adminUser)
    expect(ws.closes).toEqual([{ code: 4004, reason: 'agent not found' }])
  })
})

describe('ACP WebSocket routes', () => {
  test('/acp/ws is API-key-only: an access token is closed with 4003', async () => {
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: { ...acpWebsocket, idleTimeout: 30 } })
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out')), 2000)
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/acp/ws`, [encodeWebSocketAuthProtocol(s.memberToken)])
        ws.addEventListener('close', (event) => {
          clearTimeout(timeout)
          resolve(event.code)
        })
        ws.addEventListener('error', () => {})
      })
      expect(code).toBe(4003)
    } finally {
      await server.stop(true)
    }
  })

  test('/acp/ws accepts an API key and registers an owned agent', async () => {
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: { ...acpWebsocket, idleTimeout: 30 } })
    try {
      const message = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out')), 2000)
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/acp/ws`, [encodeWebSocketAuthProtocol(s.memberApiKey)])
        ws.addEventListener('open', () => {
          ws.send(`${JSON.stringify({ type: 'register', agent_name: 'ws-agent' })}\n`)
        })
        ws.addEventListener('message', (event) => {
          const data = typeof event.data === 'string' ? event.data : String(event.data)
          if (!data.includes('"registered"')) return
          clearTimeout(timeout)
          ws.close()
          resolve(data)
        })
        ws.addEventListener('error', () => {})
      })

      expect(message).toContain('"agent_id"')
      const agents = await s.repos.environments.listByWorkerType('acp', { ownerUserId: s.member.id })
      expect(agents).toHaveLength(1)
      expect(agents[0]?.machineName).toBe('ws-agent')
    } finally {
      await server.stop(true)
    }
  })

  test('/acp/relay accepts an access token and enforces ownership with 4003', async () => {
    const foreign = await s.repos.environments.create({ ownerUserId: s.other.id, workerType: 'acp', bridgeId: 'g' })
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: { ...acpWebsocket, idleTimeout: 30 } })
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out')), 2000)
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/acp/relay/${foreign.id}`, [
          encodeWebSocketAuthProtocol(s.memberToken),
        ])
        ws.addEventListener('close', (event) => {
          clearTimeout(timeout)
          resolve(event.code)
        })
        ws.addEventListener('error', () => {})
      })
      expect(code).toBe(4003)
    } finally {
      await server.stop(true)
    }
  })
})
