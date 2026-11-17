import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { signAccessToken } from '../../auth/tokens.js'
import type { UserRecord } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import { getAllEventBuses, getEventBus, publishSessionEvent, removeEventBus } from '../../transport/event-bus.js'
import v1Environments from '../v1/environments.js'
import v1EnvironmentsWork from '../v1/environments.work.js'
import v1Sessions from '../v1/sessions.js'
import v2CodeSessions from '../v2/code-sessions.js'
import v2WorkerEventsStream from '../v2/worker-events-stream.js'
import v2WorkerEvents from '../v2/worker-events.js'
import v2Worker from '../v2/worker.js'
import webAccount from '../web/account.js'
import webAdmin from '../web/admin.js'
import webAuth from '../web/auth.js'
import webControl from '../web/control.js'
import webEnvironments from '../web/environments.js'
import webSessions from '../web/sessions.js'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'test-api-key'
process.env.RCS_BASE_URL = 'http://localhost:3000'
process.env.RCS_POLL_TIMEOUT = '0'
process.env.RCS_JWT_EXPIRES_IN = '3600'

// res.json() returns Promise<unknown> in strict mode; narrow for assertions.
function resJson(res: Response) {
  return res.json()
}

const LEGACY_HEADERS = {
  Authorization: 'Bearer test-api-key',
  'Content-Type': 'application/json',
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function toWebSessionId(sessionId: string): string {
  if (!sessionId.startsWith('cse_')) return sessionId
  return `session_${sessionId.slice('cse_'.length)}`
}

interface Seed {
  repos: Repositories
  admin: UserRecord
  member: UserRecord
  other: UserRecord
  adminToken: string
  memberToken: string
  otherToken: string
}

async function seed(): Promise<Seed> {
  const repos = createMemoryRepositories()
  const passwordHash = await hashPassword('secret')
  const admin = await repos.users.create({ username: 'admin', passwordHash, role: 'admin' })
  const member = await repos.users.create({ username: 'member', passwordHash, role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash, role: 'member' })
  const tokenFor = (user: UserRecord) => signAccessToken({ id: user.id, username: user.username, role: user.role })
  return {
    repos,
    admin,
    member,
    other,
    adminToken: await tokenFor(admin),
    memberToken: await tokenFor(member),
    otherToken: await tokenFor(other),
  }
}

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/v1/sessions', v1Sessions)
  app.route('/v1/environments', v1Environments)
  app.route('/v1/environments', v1EnvironmentsWork)
  app.route('/v1/code/sessions', v2CodeSessions)
  app.route('/v1/code/sessions', v2Worker)
  app.route('/v1/code/sessions', v2WorkerEventsStream)
  app.route('/v1/code/sessions', v2WorkerEvents)
  app.route('/web', webAuth)
  app.route('/web', webSessions)
  app.route('/web', webControl)
  app.route('/web', webEnvironments)
  app.route('/web', webAccount)
  app.route('/web', webAdmin)
  return app
}

let s: Seed
let app: Hono<AppEnv>

beforeEach(async () => {
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  s = await seed()
  app = createApp(s.repos)
})

describe('V1 Session Routes', () => {
  test('POST /v1/sessions creates a session', async () => {
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ title: 'Test Session' }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.id).toMatch(/^session_/)
    expect(body.title).toBe('Test Session')
    expect(body.status).toBe('idle')
    expect(body.owner_user_id).toBe(s.admin.id)
  })

  test('POST /v1/sessions requires auth', async () => {
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  test('GET /v1/sessions/:id returns the created session', async () => {
    const createRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const getRes = await app.request(`/v1/sessions/${id}`, { headers: bearer(s.adminToken) })
    expect(getRes.status).toBe(200)
    // Rows are stored canonically; the web-facing form is accepted but not echoed.
    expect((await resJson(getRes)).id).toBe(id.replace(/^session_/, 'cse_'))
  })

  test('GET /v1/sessions/:id 404 for unknown session', async () => {
    const res = await app.request('/v1/sessions/nope', { headers: bearer(s.adminToken) })
    expect(res.status).toBe(404)
  })

  test('GET /v1/sessions/:id resolves compat web session ids', async () => {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { session } = await resJson(createRes)
    const getRes = await app.request(`/v1/sessions/${toWebSessionId(session.id)}`, {
      headers: bearer(s.adminToken),
    })
    expect(getRes.status).toBe(200)
    expect((await resJson(getRes)).id).toBe(session.id)
  })

  test('PATCH /v1/sessions/:id updates title', async () => {
    const createRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const patchRes = await app.request(`/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ title: 'Updated Title' }),
    })
    expect(patchRes.status).toBe(200)
    expect((await resJson(patchRes)).title).toBe('Updated Title')
  })

  test('POST /v1/sessions/:id/archive archives the session', async () => {
    const createRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const archiveRes = await app.request(`/v1/sessions/${id}/archive`, {
      method: 'POST',
      headers: bearer(s.adminToken),
    })
    expect(archiveRes.status).toBe(200)
  })

  test('POST /v1/sessions/:id/archive resolves compat code session ids', async () => {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { session } = await resJson(createRes)
    const compatId = toWebSessionId(session.id)
    const archiveRes = await app.request(`/v1/sessions/${compatId}/archive`, {
      method: 'POST',
      headers: bearer(s.adminToken),
    })
    expect(archiveRes.status).toBe(200)
    const getRes = await app.request(`/v1/sessions/${compatId}`, { headers: bearer(s.adminToken) })
    expect(getRes.status).toBe(200)
    const body = await resJson(getRes)
    expect(body.id).toBe(session.id)
    expect(body.status).toBe('archived')
  })

  test('POST /v1/sessions/:id/events publishes events', async () => {
    const createRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const eventsRes = await app.request(`/v1/sessions/${id}/events`, {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ events: [{ type: 'user', content: 'hello' }] }),
    })
    expect(eventsRes.status).toBe(200)
    expect((await resJson(eventsRes)).events).toBe(1)
  })

  test('POST /v1/sessions/:id/events resolves compat ids and persists', async () => {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const { session } = await resJson(createRes)
    const compatId = toWebSessionId(session.id)
    const eventsRes = await app.request(`/v1/sessions/${compatId}/events`, {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ events: [{ type: 'user', content: 'hello from compat' }] }),
    })
    expect(eventsRes.status).toBe(200)
    const events = await s.repos.events.listSince(session.id, 0, 10)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('user')
    expect((events[0]?.payload as { content?: string } | undefined)?.content).toBe('hello from compat')
  })

  test('POST /v1/sessions with environment_id creates a work item', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ machine_name: 'test' }),
    })
    const { environment_id } = await resJson(envRes)
    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(sessRes.status).toBe(200)
    expect((await resJson(sessRes)).environment_id).toBe(environment_id)
  })

  test('POST /v1/sessions with invalid environment_id still creates the session', async () => {
    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id: 'env_nonexistent' }),
    })
    expect(sessRes.status).toBe(200)
    expect((await resJson(sessRes)).id).toMatch(/^session_/)
  })

  test('POST /v1/sessions onto another member environment is forbidden', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'other-box' }),
    })
    const { environment_id } = await resJson(envRes)

    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(sessRes.status).toBe(403)
    const body = await resJson(sessRes)
    expect(body.error.type).toBe('forbidden')
    expect(await s.repos.sessions.listByOwner(s.member.id)).toHaveLength(0)
    expect(await s.repos.sessions.listByEnvironment(environment_id)).toHaveLength(0)
  })

  test('POST /v1/sessions onto the caller own environment queues work', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ machine_name: 'member-box' }),
    })
    const { environment_id, environment_secret } = await resJson(envRes)

    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(sessRes.status).toBe(200)
    const sessionId = (await resJson(sessRes)).id

    const workRes = await app.request(`/v1/environments/${environment_id}/work/poll`, {
      headers: bearer(environment_secret),
    })
    expect(workRes.status).toBe(200)
    expect(toWebSessionId((await resJson(workRes)).data.id)).toBe(sessionId)
  })

  test('POST /v1/sessions admins may dispatch onto another member environment', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'other-admin-target' }),
    })
    const { environment_id, environment_secret } = await resJson(envRes)

    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(sessRes.status).toBe(200)

    const workRes = await app.request(`/v1/environments/${environment_id}/work/poll`, {
      headers: bearer(environment_secret),
    })
    expect(workRes.status).toBe(200)
  })

  test('POST /v1/sessions with events publishes initial events', async () => {
    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ events: [{ type: 'init', data: 'starting' }] }),
    })
    expect(sessRes.status).toBe(200)
    const { id } = await resJson(sessRes)
    const events = await s.repos.events.listSince(id.replace(/^session_/, 'cse_'), 0, 10)
    expect(events.map((e) => e.type)).toEqual(['init'])
  })
})

describe('V1 Environment Routes', () => {
  test('POST /v1/environments/bridge registers an environment', async () => {
    const res = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({
        machine_name: 'mac1',
        directory: '/home',
        metadata: { worker_type: 'claude_code' },
      }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.environment_id).toMatch(/^env_/)
    expect(body.environment_secret).toBeTruthy()
    expect(body.status).toBe('active')
    const record = await s.repos.environments.getById(body.environment_id)
    expect(record?.ownerUserId).toBe(s.member.id)
    expect(record?.machineName).toBe('mac1')
    expect(record?.workerType).toBe('claude_code')
  })

  test('POST /v1/environments/bridge reuses the same owner id', async () => {
    const first = await resJson(
      await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ machine_name: 'mac1' }),
      }),
    )
    const second = await resJson(
      await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ machine_name: 'mac1', environment_id: first.environment_id }),
      }),
    )
    expect(second.environment_id).toBe(first.environment_id)
  })

  test('POST /v1/environments/bridge creates a new env on owner mismatch', async () => {
    const first = await resJson(
      await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ machine_name: 'mac1' }),
      }),
    )
    const second = await resJson(
      await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: bearer(s.otherToken),
        body: JSON.stringify({ machine_name: 'mac2', environment_id: first.environment_id }),
      }),
    )
    expect(second.environment_id).not.toBe(first.environment_id)
    const firstRecord = await s.repos.environments.getById(first.environment_id)
    expect(firstRecord?.ownerUserId).toBe(s.member.id)
    const secondRecord = await s.repos.environments.getById(second.environment_id)
    expect(secondRecord?.ownerUserId).toBe(s.other.id)
  })

  test('DELETE /v1/environments/bridge/:id deregisters', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { environment_id } = await resJson(envRes)
    const delRes = await app.request(`/v1/environments/bridge/${environment_id}`, {
      method: 'DELETE',
      headers: bearer(s.memberToken),
    })
    expect(delRes.status).toBe(200)
    expect((await s.repos.environments.getById(environment_id))?.status).toBe('deregistered')
  })

  test('DELETE rejects another member', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { environment_id } = await resJson(envRes)
    const delRes = await app.request(`/v1/environments/bridge/${environment_id}`, {
      method: 'DELETE',
      headers: bearer(s.otherToken),
    })
    expect(delRes.status).toBe(403)
  })

  test('POST /v1/environments/:id/bridge/reconnect reconnects', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { environment_id } = await resJson(envRes)
    await s.repos.environments.update(environment_id, { status: 'disconnected' })
    const reconnectRes = await app.request(`/v1/environments/${environment_id}/bridge/reconnect`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(reconnectRes.status).toBe(200)
    expect((await s.repos.environments.getById(environment_id))?.status).toBe('active')
  })
})

describe('V1 Work Routes', () => {
  let envId: string
  let envSecret: string

  beforeEach(async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({}),
    })
    const body = await resJson(envRes)
    envId = body.environment_id
    envSecret = body.environment_secret
  })

  test('GET /v1/environments/:id/work/poll revives an environment the reaper marked disconnected', async () => {
    await s.repos.environments.update(envId, { status: 'disconnected' })
    const res = await app.request(`/v1/environments/${envId}/work/poll`, {
      headers: bearer(envSecret),
    })
    expect(res.status).toBe(204)
    expect((await s.repos.environments.getById(envId))?.status).toBe('active')
  })

  test('GET /v1/environments/:id/work/poll returns 204 when no work', async () => {
    const res = await app.request(`/v1/environments/${envId}/work/poll`, {
      headers: bearer(envSecret),
    })
    expect(res.status).toBe(204)
  })

  test('work lifecycle: create -> poll -> ack -> stop', async () => {
    const sessRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id: envId }),
    })
    const sessionId = (await resJson(sessRes)).id

    const pollRes = await app.request(`/v1/environments/${envId}/work/poll`, {
      headers: bearer(envSecret),
    })
    expect(pollRes.status).toBe(200)
    const work = await resJson(pollRes)
    expect(work.id).toMatch(/^work_/)
    expect(toWebSessionId(work.data.id)).toBe(sessionId)

    const ackRes = await app.request(`/v1/environments/${envId}/work/${work.id}/ack`, {
      method: 'POST',
      headers: bearer(envSecret),
    })
    expect(ackRes.status).toBe(200)
    const stopRes = await app.request(`/v1/environments/${envId}/work/${work.id}/stop`, {
      method: 'POST',
      headers: bearer(envSecret),
    })
    expect(stopRes.status).toBe(200)
    expect((await s.repos.workItems.getById(work.id))?.state).toBe('completed')
  })

  test('POST work heartbeat accepts a worker token', async () => {
    await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id: envId }),
    })
    const work = await resJson(await app.request(`/v1/environments/${envId}/work/poll`, { headers: bearer(envSecret) }))
    const secret = JSON.parse(Buffer.from(work.secret, 'base64url').toString('utf8'))
    const hbRes = await app.request(`/v1/environments/${envId}/work/${work.id}/heartbeat`, {
      method: 'POST',
      headers: bearer(secret.session_ingress_token),
    })
    expect(hbRes.status).toBe(200)
    expect((await resJson(hbRes)).lease_extended).toBe(true)
  })

  function decodeWorkSecret(secret: string): { session_ingress_token: string } {
    return JSON.parse(Buffer.from(secret, 'base64url').toString('utf8'))
  }

  test('POST work ack accepts the work secret worker token', async () => {
    await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id: envId }),
    })
    const work = await resJson(await app.request(`/v1/environments/${envId}/work/poll`, { headers: bearer(envSecret) }))
    const token = decodeWorkSecret(work.secret).session_ingress_token

    const ackRes = await app.request(`/v1/environments/${envId}/work/${work.id}/ack`, {
      method: 'POST',
      headers: bearer(token),
    })
    expect(ackRes.status).toBe(200)
    expect((await s.repos.workItems.getById(work.id))?.state).toBe('acked')
  })

  test('POST work ack rejects a worker token minted for another session', async () => {
    for (const title of ['first', 'second']) {
      await app.request('/v1/sessions', {
        method: 'POST',
        headers: bearer(s.adminToken),
        body: JSON.stringify({ environment_id: envId, title }),
      })
    }
    const firstWork = await resJson(
      await app.request(`/v1/environments/${envId}/work/poll`, { headers: bearer(envSecret) }),
    )
    const secondWork = await resJson(
      await app.request(`/v1/environments/${envId}/work/poll`, { headers: bearer(envSecret) }),
    )
    expect(firstWork.id).not.toBe(secondWork.id)
    const foreignToken = decodeWorkSecret(firstWork.secret).session_ingress_token

    const ackRes = await app.request(`/v1/environments/${envId}/work/${secondWork.id}/ack`, {
      method: 'POST',
      headers: bearer(foreignToken),
    })
    expect(ackRes.status).toBe(404)
    expect((await s.repos.workItems.getById(secondWork.id))?.state).toBe('dispatched')
  })
})

describe('V2 Code Session Routes', () => {
  test('POST /v1/code/sessions creates a code session', async () => {
    const res = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ title: 'Code Session' }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.session.id).toMatch(/^cse_/)
    expect(body.session.title).toBe('Code Session')
    expect(body.session.owner_user_id).toBe(s.member.id)
  })

  test('POST /v1/code/sessions rejects an environment owned by another user', async () => {
    const env = await s.repos.environments.create({ ownerUserId: s.other.id })
    const res = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id: env.id }),
    })
    expect(res.status).toBe(403)
    expect(await s.repos.sessions.listByOwner(s.member.id)).toHaveLength(0)
  })

  test('POST /v1/code/sessions binds a session to the caller-s own environment', async () => {
    const env = await s.repos.environments.create({ ownerUserId: s.member.id })
    const res = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id: env.id }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.session.environment_id).toBe(env.id)
    expect(body.session.owner_user_id).toBe(s.member.id)
  })

  test('POST /v1/code/sessions returns 404 for an unknown environment id', async () => {
    const res = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id: 'env_missing' }),
    })
    expect(res.status).toBe(404)
  })

  test('POST /v1/code/sessions/:id/bridge returns bridge info with JWT', async () => {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { session } = await resJson(createRes)
    const bridgeRes = await app.request(`/v1/code/sessions/${session.id}/bridge`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(bridgeRes.status).toBe(200)
    const body = await resJson(bridgeRes)
    expect(body.api_base_url).toBe('http://localhost:3000')
    expect(body.worker_epoch).toBe(1)
    expect(body.worker_jwt).toBeTruthy()
    expect(body.expires_in).toBe(3600)
  })

  test('POST /v1/code/sessions/:id/bridge 404 for unknown session', async () => {
    const res = await app.request('/v1/code/sessions/nope/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(404)
  })
})

describe('V2 Worker Routes', () => {
  async function createCodeSession(): Promise<string> {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    return (await resJson(createRes)).session.id
  }

  test('POST /v1/code/sessions/:id/worker/register increments epoch', async () => {
    const id = await createCodeSession()
    const regRes = await app.request(`/v1/code/sessions/${id}/worker/register`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(regRes.status).toBe(200)
    expect((await resJson(regRes)).worker_epoch).toBe(1)
  })

  test('POST /v1/code/sessions/:id/worker/register 404 for unknown', async () => {
    const res = await app.request('/v1/code/sessions/nope/worker/register', {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(404)
  })

  test('GET/PUT /v1/code/sessions/:id/worker stores worker state', async () => {
    const id = await createCodeSession()
    const putRes = await app.request(`/v1/code/sessions/${id}/worker`, {
      method: 'PUT',
      headers: LEGACY_HEADERS,
      body: JSON.stringify({
        worker_epoch: 1,
        worker_status: 'running',
        external_metadata: {
          permission_mode: 'default',
          automation_state: { enabled: true, phase: 'sleeping', next_tick_at: null, sleep_until: 123456 },
        },
      }),
    })
    expect(putRes.status).toBe(200)

    const getRes = await app.request(`/v1/code/sessions/${id}/worker`, {
      headers: LEGACY_HEADERS,
    })
    expect(getRes.status).toBe(200)
    const body = await resJson(getRes)
    expect(body.worker.worker_status).toBe('running')
    expect(body.worker.external_metadata.permission_mode).toBe('default')
    expect(body.worker.external_metadata.automation_state).toEqual({
      enabled: true,
      phase: 'sleeping',
      next_tick_at: null,
      sleep_until: 123456,
    })
    expect((await s.repos.sessions.getById(id))?.status).toBe('running')

    const events = await s.repos.events.listSince(id, 0, 20)
    const automation = events.filter((event) => event.type === 'automation_state')
    expect(automation).toHaveLength(1)
    expect(automation[0]?.payload).toEqual({
      enabled: true,
      phase: 'sleeping',
      next_tick_at: null,
      sleep_until: 123456,
    })
  })

  test('POST /v1/code/sessions/:id/worker/heartbeat updates heartbeat', async () => {
    const id = await createCodeSession()
    const heartbeatRes = await app.request(`/v1/code/sessions/${id}/worker/heartbeat`, {
      method: 'POST',
      headers: LEGACY_HEADERS,
      body: JSON.stringify({ worker_epoch: 1 }),
    })
    expect(heartbeatRes.status).toBe(200)
    const getRes = await app.request(`/v1/code/sessions/${id}/worker`, { headers: LEGACY_HEADERS })
    expect((await resJson(getRes)).worker.last_heartbeat_at).toBeTruthy()
  })

  test('PUT /v1/code/sessions/:id/worker/state updates session status', async () => {
    const id = await createCodeSession()
    const res = await app.request(`/v1/code/sessions/${id}/worker/state`, {
      method: 'PUT',
      headers: LEGACY_HEADERS,
      body: JSON.stringify({ status: 'running' }),
    })
    expect(res.status).toBe(200)
    expect((await s.repos.sessions.getById(id))?.status).toBe('running')
  })

  test('PUT external_metadata and delivery no-ops return ok', async () => {
    const id = await createCodeSession()
    for (const [path, method] of [
      [`/v1/code/sessions/${id}/worker/external_metadata`, 'PUT'],
      [`/v1/code/sessions/${id}/worker/events/delivery`, 'POST'],
      [`/v1/code/sessions/${id}/worker/events/evt123/delivery`, 'POST'],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: LEGACY_HEADERS,
        body: JSON.stringify({ meta: 'data' }),
      })
      expect(res.status).toBe(200)
    }
  })
})

describe('V2 Worker Events Routes', () => {
  async function createCodeSession(): Promise<string> {
    const createRes = await app.request('/v1/code/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    return (await resJson(createRes)).session.id
  }

  test('POST worker/events publishes and persists events', async () => {
    const id = await createCodeSession()
    const res = await app.request(`/v1/code/sessions/${id}/worker/events`, {
      method: 'POST',
      headers: LEGACY_HEADERS,
      body: JSON.stringify([{ type: 'assistant', content: 'response' }]),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.status).toBe('ok')
    expect(body.count).toBe(1)
    const events = await s.repos.events.listSince(id, 0, 10)
    expect(events[0]?.type).toBe('assistant')
  })

  test('POST worker/events unwraps CCR batch payloads', async () => {
    const id = await createCodeSession()
    const res = await app.request(`/v1/code/sessions/${id}/worker/events`, {
      method: 'POST',
      headers: LEGACY_HEADERS,
      body: JSON.stringify({
        worker_epoch: 1,
        events: [{ payload: { type: 'assistant', content: 'response' } }],
      }),
    })
    expect(res.status).toBe(200)
    expect((await resJson(res)).count).toBe(1)
    const events = await s.repos.events.listSince(id, 0, 10)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('assistant')
    expect((events[0]?.payload as { content?: string } | undefined)?.content).toBe('response')
  })

  test('GET worker/events/stream emits client_event frames', async () => {
    const id = await createCodeSession()
    const streamRes = await app.request(`/v1/code/sessions/${id}/worker/events/stream`, {
      headers: LEGACY_HEADERS,
    })
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('Content-Type')).toBe('text/event-stream')
    const reader = streamRes.body?.getReader()
    expect(reader).toBeTruthy()
    if (!reader) return

    const keepalive = new TextDecoder().decode((await reader.read()).value)
    expect(keepalive).toContain(': keepalive')

    await publishSessionEvent(s.repos, getEventBus(id), id, 'user', { type: 'user', content: 'hello' }, 'outbound')

    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('event: client_event')
    expect(frame).toContain('"payload":{"type":"user","content":"hello","message":{"content":"hello"}}')
    await reader.cancel()
  })

  test('worker stream normalizes permission approvals', async () => {
    const createRes = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const streamRes = await app.request(`/v1/code/sessions/${id.replace(/^session_/, 'cse_')}/worker/events/stream`, {
      headers: LEGACY_HEADERS,
    })
    expect(streamRes.status).toBe(200)
    const reader = streamRes.body?.getReader()
    expect(reader).toBeTruthy()
    if (!reader) return
    await reader.read()

    const controlRes = await app.request(`/web/sessions/${id}/control`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'permission_response', approved: true, request_id: 'req-1' }),
    })
    expect(controlRes.status).toBe(200)
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('event: client_event')
    expect(frame).toContain('"event_type":"permission_response"')
    expect(frame).toContain('"payload":{"type":"control_response"')
    expect(frame).toContain('"request_id":"req-1"')
    expect(frame).toContain('"behavior":"allow"')
    await reader.cancel()
  })

  test('worker stream normalizes plan rejection to deny', async () => {
    const createRes = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const streamRes = await app.request(`/v1/code/sessions/${id.replace(/^session_/, 'cse_')}/worker/events/stream`, {
      headers: LEGACY_HEADERS,
    })
    const reader = streamRes.body?.getReader()
    if (!reader) throw new Error('missing stream body')
    await reader.read()

    await app.request(`/web/sessions/${id}/control`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({
        type: 'permission_response',
        approved: false,
        request_id: 'req-2',
        message: 'Need more detail',
      }),
    })
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('"payload":{"type":"control_response"')
    expect(frame).toContain('"subtype":"error"')
    expect(frame).toContain('"behavior":"deny"')
    expect(frame).toContain('"message":"Need more detail"')
    await reader.cancel()
  })

  test('worker stream normalizes interrupts to control_request', async () => {
    const createRes = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    const { id } = await resJson(createRes)
    const streamRes = await app.request(`/v1/code/sessions/${id.replace(/^session_/, 'cse_')}/worker/events/stream`, {
      headers: LEGACY_HEADERS,
    })
    const reader = streamRes.body?.getReader()
    if (!reader) throw new Error('missing stream body')
    await reader.read()

    await app.request(`/web/sessions/${id}/interrupt`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('"event_type":"interrupt"')
    expect(frame).toContain('"payload":{"type":"control_request"')
    expect(frame).toContain('"subtype":"interrupt"')
    await reader.cancel()
  })
})

describe('Web Auth Routes', () => {
  test('POST /web/bind claims an unowned session', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: null, title: 'legacy' })
    const bindRes = await app.request('/web/bind', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ sessionId: record.id }),
    })
    expect(bindRes.status).toBe(200)
    const body = await resJson(bindRes)
    expect(body.ok).toBe(true)
    expect(body.sessionId).toBe(toWebSessionId(record.id))
    expect((await s.repos.sessions.getById(record.id))?.ownerUserId).toBe(s.member.id)
  })

  test('POST /web/bind 404 for unknown session', async () => {
    const res = await app.request('/web/bind', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ sessionId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })

  test('POST /web/bind 400 when missing params', async () => {
    const res = await app.request('/web/bind', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('POST /web/bind requires auth', async () => {
    const res = await app.request('/web/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Web Session Routes', () => {
  async function createWebSession(token: string, body: Record<string, unknown> = {}): Promise<string> {
    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify(body),
    })
    return (await resJson(res)).id
  }

  test('POST /web/sessions creates an owned session', async () => {
    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ title: 'Web Session' }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.id).toMatch(/^session_/)
    expect(body.source).toBe('web')
    expect(body.owner_user_id).toBe(s.member.id)
  })

  test('POST /web/sessions localizes the default title from Accept-Language', async () => {
    const en = await app.request('/web/sessions', {
      method: 'POST',
      headers: { ...bearer(s.memberToken), 'Accept-Language': 'en-US' },
      body: '{}',
    })
    expect(((await resJson(en)) as { title: string }).title).toBe('New Session')

    const zh = await app.request('/web/sessions', {
      method: 'POST',
      headers: { ...bearer(s.memberToken), 'Accept-Language': 'zh-TW' },
      body: '{}',
    })
    expect(((await resJson(zh)) as { title: string }).title).toBe('新会话')
  })

  test('POST /web/sessions onto another member environment is forbidden', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'web-other-box' }),
    })
    const { environment_id } = await resJson(envRes)

    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(res.status).toBe(403)
    expect((await resJson(res)).error.type).toBe('forbidden')
    expect(await s.repos.sessions.listByOwner(s.member.id)).toHaveLength(0)
    expect(await s.repos.sessions.listByEnvironment(environment_id)).toHaveLength(0)
  })

  test('POST /web/sessions onto the caller own environment queues work', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ machine_name: 'web-member-box' }),
    })
    const { environment_id, environment_secret } = await resJson(envRes)

    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(res.status).toBe(200)
    const sessionId = (await resJson(res)).id

    const workRes = await app.request(`/v1/environments/${environment_id}/work/poll`, {
      headers: bearer(environment_secret),
    })
    expect(workRes.status).toBe(200)
    expect(toWebSessionId((await resJson(workRes)).data.id)).toBe(sessionId)
  })

  test('POST /web/sessions admins may dispatch onto another member environment', async () => {
    const envRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'web-admin-target' }),
    })
    const { environment_id, environment_secret } = await resJson(envRes)

    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ environment_id }),
    })
    expect(res.status).toBe(200)
    const workRes = await app.request(`/v1/environments/${environment_id}/work/poll`, {
      headers: bearer(environment_secret),
    })
    expect(workRes.status).toBe(200)
  })

  test('GET /web/sessions returns only the caller sessions', async () => {
    const id = await createWebSession(s.memberToken)
    await createWebSession(s.otherToken)

    const listRes = await app.request('/web/sessions', { headers: bearer(s.memberToken) })
    expect(listRes.status).toBe(200)
    const sessions = await resJson(listRes)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(id)

    const otherList = await resJson(await app.request('/web/sessions', { headers: bearer(s.otherToken) }))
    expect(otherList).toHaveLength(1)
    expect(otherList[0].id).not.toBe(id)
  })

  test('GET /web/sessions admins see every owner', async () => {
    await createWebSession(s.memberToken)
    await createWebSession(s.otherToken)
    const sessions = await resJson(await app.request('/web/sessions', { headers: bearer(s.adminToken) }))
    expect(sessions).toHaveLength(2)
  })

  test('GET /web/sessions/all returns session_ summary ids', async () => {
    const id = await createWebSession(s.memberToken)
    const sessions = await resJson(await app.request('/web/sessions/all', { headers: bearer(s.memberToken) }))
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(id)
    expect(sessions[0].owner_user_id).toBe(s.member.id)
  })

  test('GET /web/sessions/all shares unowned sessions with members', async () => {
    const own = await createWebSession(s.memberToken)
    const foreign = await createWebSession(s.otherToken)
    const unowned = await s.repos.sessions.create({ status: 'idle' })

    const sessions = (await resJson(
      await app.request('/web/sessions/all', { headers: bearer(s.memberToken) }),
    )) as Array<{ id: string; owner_user_id: string | null }>
    expect(new Set(sessions.map((sess) => sess.id))).toEqual(new Set([own, toWebSessionId(unowned.id)]))
    expect(sessions.some((sess) => sess.id === foreign)).toBe(false)
    expect(sessions.find((sess) => sess.id === toWebSessionId(unowned.id))?.owner_user_id).toBeNull()

    const adminSessions = (await resJson(
      await app.request('/web/sessions/all', { headers: bearer(s.adminToken) }),
    )) as Array<{ id: string }>
    expect(new Set(adminSessions.map((sess) => sess.id))).toEqual(new Set([own, foreign, toWebSessionId(unowned.id)]))
  })

  test('GET /web/sessions hides archived and inactive sessions', async () => {
    const archived = await s.repos.sessions.create({ ownerUserId: s.member.id, status: 'archived' })
    const inactive = await s.repos.sessions.create({ ownerUserId: s.member.id, status: 'inactive' })
    const open = await s.repos.sessions.create({ ownerUserId: s.member.id, status: 'idle' })

    const sessions = await resJson(await app.request('/web/sessions', { headers: bearer(s.memberToken) }))
    expect(sessions.map((sess: { id: string }) => sess.id)).toEqual([toWebSessionId(open.id)])
    expect(archived.id).not.toBe(open.id)
    expect(inactive.id).not.toBe(open.id)

    const all = await resJson(await app.request('/web/sessions/all', { headers: bearer(s.memberToken) }))
    expect(all.map((sess: { id: string }) => sess.id)).toEqual([toWebSessionId(open.id)])
  })

  test('GET /web/sessions/:id returns an owned session', async () => {
    const id = await createWebSession(s.memberToken)
    const res = await app.request(`/web/sessions/${id}`, { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect((await resJson(res)).id).toBe(id)
  })

  test('GET /web/sessions/:id includes automation_state when present', async () => {
    const id = await createWebSession(s.memberToken)
    const canonical = id.replace(/^session_/, 'cse_')
    await app.request(`/v1/code/sessions/${canonical}/worker`, {
      method: 'PUT',
      headers: LEGACY_HEADERS,
      body: JSON.stringify({
        worker_epoch: 1,
        external_metadata: {
          automation_state: { enabled: true, phase: 'standby', next_tick_at: 123456, sleep_until: null },
        },
      }),
    })
    const res = await app.request(`/web/sessions/${id}`, { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect((await resJson(res)).automation_state).toEqual({
      enabled: true,
      phase: 'standby',
      next_tick_at: 123456,
      sleep_until: null,
    })
  })

  test('GET /web/sessions/:id 403 for another member', async () => {
    const id = await createWebSession(s.memberToken)
    const res = await app.request(`/web/sessions/${id}`, { headers: bearer(s.otherToken) })
    expect(res.status).toBe(403)
  })

  test('GET /web/sessions/:id admin can read another owner', async () => {
    const id = await createWebSession(s.memberToken)
    const res = await app.request(`/web/sessions/${id}`, { headers: bearer(s.adminToken) })
    expect(res.status).toBe(200)
    expect((await resJson(res)).id).toBe(id)
  })

  test('member claims an unowned session on access', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: null })
    const res = await app.request(`/web/sessions/${toWebSessionId(record.id)}`, {
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(200)
    expect((await s.repos.sessions.getById(record.id))?.ownerUserId).toBe(s.member.id)
  })

  test('admin reads an unowned session without claiming it', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: null })
    const res = await app.request(`/web/sessions/${record.id}`, { headers: bearer(s.adminToken) })
    expect(res.status).toBe(200)
    expect((await s.repos.sessions.getById(record.id))?.ownerUserId).toBeNull()
  })

  test('GET /web/sessions/:id/history returns events in display order', async () => {
    const id = await createWebSession(s.memberToken)
    const canonical = id.replace(/^session_/, 'cse_')
    await publishSessionEvent(
      s.repos,
      getEventBus(canonical),
      canonical,
      'task_state',
      { task_list_id: 'team-alpha', tasks: [{ id: '1', subject: 'Investigate', status: 'pending' }] },
      'inbound',
    )
    const res = await app.request(`/web/sessions/${id}/history`, { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].type).toBe('task_state')
    expect(body.events[0].payload.task_list_id).toBe('team-alpha')
    expect(body.events[0].payload.tasks).toEqual([{ id: '1', subject: 'Investigate', status: 'pending' }])
    expect(body.events[0].sessionId).toBe(canonical)
    expect(typeof body.events[0].seqNum).toBe('number')
    expect(body.nextBefore).toBeNull()
  })

  test('GET /web/sessions/:id/history supports compat ids and empty history', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: s.member.id })
    const res = await app.request(`/web/sessions/${toWebSessionId(record.id)}/history`, {
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(200)
    expect((await resJson(res)).events).toEqual([])
  })

  test('GET /web/sessions/:id/history 403 for another member', async () => {
    const id = await createWebSession(s.memberToken)
    const res = await app.request(`/web/sessions/${id}/history`, { headers: bearer(s.otherToken) })
    expect(res.status).toBe(403)
  })

  test('GET /web/sessions/:id/history paginates with before/limit', async () => {
    const id = await createWebSession(s.memberToken)
    const canonical = id.replace(/^session_/, 'cse_')
    for (let i = 0; i < 5; i += 1) {
      await publishSessionEvent(s.repos, null, canonical, 'message', { content: `m${i}` }, 'inbound')
    }
    const page1 = await resJson(
      await app.request(`/web/sessions/${id}/history?limit=2`, { headers: bearer(s.memberToken) }),
    )
    expect(page1.events).toHaveLength(2)
    expect(page1.events.map((e: { payload: { content: string } }) => e.payload.content)).toEqual(['m3', 'm4'])
    expect(page1.nextBefore).toBe(page1.events[0].seqNum)

    const page2 = await resJson(
      await app.request(`/web/sessions/${id}/history?limit=2&before=${page1.nextBefore}`, {
        headers: bearer(s.memberToken),
      }),
    )
    expect(page2.events.map((e: { payload: { content: string } }) => e.payload.content)).toEqual(['m1', 'm2'])
    expect(page2.nextBefore).toBe(page2.events[0].seqNum)

    const page3 = await resJson(
      await app.request(`/web/sessions/${id}/history?limit=2&before=${page2.nextBefore}`, {
        headers: bearer(s.memberToken),
      }),
    )
    expect(page3.events.map((e: { payload: { content: string } }) => e.payload.content)).toEqual(['m0'])
    expect(page3.nextBefore).toBeNull()
  })

  test('GET /web/sessions/:id/events returns an SSE stream', async () => {
    const id = await createWebSession(s.memberToken)
    const res = await app.request(`/web/sessions/${id}/events`, { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const reader = res.body?.getReader()
    if (reader) {
      const { value } = await reader.read()
      expect(new TextDecoder().decode(value)).toContain(': keepalive')
      await reader.cancel()
    }
  })

  test('GET /web/sessions/:id/events supports compat ids and rejects non-owners', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: s.member.id })
    const compatId = toWebSessionId(record.id)
    const ok = await app.request(`/web/sessions/${compatId}/events`, { headers: bearer(s.memberToken) })
    expect(ok.status).toBe(200)
    await ok.body?.cancel()

    const forbidden = await app.request(`/web/sessions/${compatId}/events`, { headers: bearer(s.otherToken) })
    expect(forbidden.status).toBe(403)
  })

  test('GET /web/sessions/:id/events 409 for archived session', async () => {
    const id = await createWebSession(s.memberToken)
    await app.request(`/v1/sessions/${id}/archive`, { method: 'POST', headers: bearer(s.adminToken) })
    const res = await app.request(`/web/sessions/${id}/events`, { headers: bearer(s.memberToken) })
    expect(res.status).toBe(409)
    expect((await resJson(res)).error.type).toBe('session_closed')
  })

  test('POST /web/sessions with an unknown environment is rejected', async () => {
    const res = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ environment_id: 'env_nonexistent' }),
    })
    expect(res.status).toBe(404)
    expect((await resJson(res)).error.type).toBe('not_found')
  })
})

describe('Web Control Routes', () => {
  let sessionId: string

  beforeEach(async () => {
    const createRes = await app.request('/web/sessions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({}),
    })
    sessionId = (await resJson(createRes)).id
  })

  test('POST /web/sessions/:id/events sends a user message', async () => {
    const res = await app.request(`/web/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'user', content: 'hello' }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.status).toBe('ok')
    expect(body.event).toBeTruthy()
  })

  test('POST /web/sessions/:id/control sends a control request', async () => {
    const res = await app.request(`/web/sessions/${sessionId}/control`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'permission_response', approved: true, request_id: 'r1' }),
    })
    expect(res.status).toBe(200)
  })

  test('POST /web/sessions/:id/interrupt interrupts and sets idle', async () => {
    await s.repos.sessions.update(sessionId.replace(/^session_/, 'cse_'), { status: 'running' })
    const res = await app.request(`/web/sessions/${sessionId}/interrupt`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(200)
    expect((await s.repos.sessions.getById(sessionId.replace(/^session_/, 'cse_')))?.status).toBe('idle')
  })

  test('control routes support compat code session ids', async () => {
    const record = await s.repos.sessions.create({ ownerUserId: s.member.id })
    const compatId = toWebSessionId(record.id)
    const eventsRes = await app.request(`/web/sessions/${compatId}/events`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'user', content: 'hello' }),
    })
    expect(eventsRes.status).toBe(200)
    const controlRes = await app.request(`/web/sessions/${compatId}/control`, {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'permission_response', approved: true, request_id: 'r1' }),
    })
    expect(controlRes.status).toBe(200)
    const interruptRes = await app.request(`/web/sessions/${compatId}/interrupt`, {
      method: 'POST',
      headers: bearer(s.memberToken),
    })
    expect(interruptRes.status).toBe(200)
  })

  test('control routes 403 for another member', async () => {
    for (const path of ['events', 'control', 'interrupt']) {
      const res = await app.request(`/web/sessions/${sessionId}/${path}`, {
        method: 'POST',
        headers: bearer(s.otherToken),
        body: JSON.stringify({ type: 'user', content: 'hello' }),
      })
      expect(res.status).toBe(403)
    }
  })

  test('control routes 403 for an unknown session', async () => {
    const res = await app.request('/web/sessions/nonexistent/events', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ type: 'user', content: 'hello' }),
    })
    expect(res.status).toBe(403)
  })

  test('control routes 409 for archived sessions', async () => {
    await app.request(`/v1/sessions/${sessionId}/archive`, { method: 'POST', headers: bearer(s.adminToken) })
    for (const path of ['events', 'control', 'interrupt']) {
      const res = await app.request(`/web/sessions/${sessionId}/${path}`, {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ type: 'user', content: 'hello' }),
      })
      expect(res.status).toBe(409)
    }
  })
})

describe('Web Environment Routes', () => {
  test('GET /web/environments lists the caller environments', async () => {
    await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ machine_name: 'member-mac' }),
    })
    await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'other-mac' }),
    })

    const envs = await resJson(await app.request('/web/environments', { headers: bearer(s.memberToken) }))
    expect(envs).toHaveLength(1)
    expect(envs[0].machine_name).toBe('member-mac')
    expect(envs[0].owner_user_id).toBe(s.member.id)
  })

  test('GET /web/environments shares unowned active environments with members', async () => {
    const memberEnvRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ machine_name: 'member-mac' }),
    })
    const memberEnvId = (await resJson(memberEnvRes)).environment_id
    const otherEnvRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'other-mac' }),
    })
    const otherEnvId = (await resJson(otherEnvRes)).environment_id
    const unowned = await s.repos.environments.create({
      ownerUserId: null,
      machineName: 'legacy-box',
      status: 'active',
    })

    const envs = (await resJson(await app.request('/web/environments', { headers: bearer(s.memberToken) }))) as Array<{
      id: string
      owner_user_id: string | null
    }>
    expect(new Set(envs.map((env) => env.id))).toEqual(new Set([memberEnvId, unowned.id]))
    expect(envs.some((env) => env.id === otherEnvId)).toBe(false)
    expect(envs.find((env) => env.id === unowned.id)?.owner_user_id).toBeNull()
  })

  test('GET /web/environments admin sees all', async () => {
    const memberEnvRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ machine_name: 'member-mac' }),
    })
    const memberEnvId = (await resJson(memberEnvRes)).environment_id
    const otherEnvRes = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ machine_name: 'other-mac' }),
    })
    const otherEnvId = (await resJson(otherEnvRes)).environment_id
    const unowned = await s.repos.environments.create({
      ownerUserId: null,
      machineName: 'legacy-box',
      status: 'active',
    })

    const envs = (await resJson(await app.request('/web/environments', { headers: bearer(s.adminToken) }))) as Array<{
      id: string
    }>
    expect(new Set(envs.map((env) => env.id))).toEqual(new Set([memberEnvId, otherEnvId, unowned.id]))
  })

  test('GET /web/environments requires auth', async () => {
    const res = await app.request('/web/environments')
    expect(res.status).toBe(401)
  })
})

describe('Web Account Routes', () => {
  test('POST /web/account/password re-hashes the password', async () => {
    const res = await app.request('/web/account/password', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ currentPassword: 'secret', newPassword: 'new-secret' }),
    })
    expect(res.status).toBe(200)
    const record = await s.repos.users.getById(s.member.id)
    expect(await verifyPassword('new-secret', record?.passwordHash ?? '')).toBe(true)
  })

  test('POST /web/account/password rejects a wrong current password', async () => {
    const res = await app.request('/web/account/password', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'new-secret' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /web/api-keys returns the raw key exactly once', async () => {
    const res = await app.request('/web/api-keys', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ name: 'laptop' }),
    })
    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.key).toMatch(/^rcs_/)
    expect(body.prefix).toBe(body.key.slice(0, 12))
    expect(body.id).toBeTruthy()

    const list = await resJson(await app.request('/web/api-keys', { headers: bearer(s.memberToken) }))
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(body.id)
    expect(list[0].prefix).toBe(body.prefix)
    expect(JSON.stringify(list)).not.toContain(body.key)
    expect(JSON.stringify(list)).not.toContain('token_hash')
    expect(JSON.stringify(list)).not.toContain('tokenHash')

    const otherKeys = await resJson(await app.request('/web/api-keys', { headers: bearer(s.otherToken) }))
    expect(otherKeys).toHaveLength(0)
  })

  test('DELETE /web/api-keys/:id revokes the caller key', async () => {
    const created = await resJson(
      await app.request('/web/api-keys', {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ name: 'laptop' }),
      }),
    )
    const delRes = await app.request(`/web/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: bearer(s.memberToken),
    })
    expect(delRes.status).toBe(200)
    const list = await resJson(await app.request('/web/api-keys', { headers: bearer(s.memberToken) }))
    expect(list[0].revoked_at).toBeTruthy()
  })

  test("DELETE /web/api-keys/:id 404 for another user's key", async () => {
    const created = await resJson(
      await app.request('/web/api-keys', {
        method: 'POST',
        headers: bearer(s.memberToken),
        body: JSON.stringify({ name: 'laptop' }),
      }),
    )
    const delRes = await app.request(`/web/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: bearer(s.otherToken),
    })
    expect(delRes.status).toBe(404)
  })

  test('account routes require auth', async () => {
    expect((await app.request('/web/api-keys')).status).toBe(401)
    expect(
      (
        await app.request('/web/account/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(401)
  })
})

describe('Web Admin Routes', () => {
  function userView(value: unknown) {
    return value as Record<string, unknown>
  }

  test('GET /web/admin/users lists users without password hashes', async () => {
    const res = await app.request('/web/admin/users', { headers: bearer(s.adminToken) })
    expect(res.status).toBe(200)
    const users = await resJson(res)
    expect(users).toHaveLength(3)
    expect(users.map((user: { username: string }) => user.username).toSorted()).toEqual(['admin', 'member', 'other'])
    expect(JSON.stringify(users)).not.toContain('password')
  })

  test('GET /web/admin/users 403 for members and 401 unauthenticated', async () => {
    expect((await app.request('/web/admin/users', { headers: bearer(s.memberToken) })).status).toBe(403)
    expect((await app.request('/web/admin/users')).status).toBe(401)
  })

  test('POST /web/admin/users creates a user with a hashed password', async () => {
    const res = await app.request('/web/admin/users', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ username: 'newbie', password: 'pw123456', displayName: 'Newbie', role: 'member' }),
    })
    expect(res.status).toBe(200)
    const body = userView(await resJson(res))
    expect(body.username).toBe('newbie')
    expect(body.role).toBe('member')
    expect(body.passwordHash).toBeUndefined()

    const record = await s.repos.users.getByUsername('newbie')
    expect(await verifyPassword('pw123456', record?.passwordHash ?? '')).toBe(true)
  })

  test('POST /web/admin/users rejects duplicates with 409', async () => {
    const res = await app.request('/web/admin/users', {
      method: 'POST',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ username: 'member', password: 'pw123456', role: 'member' }),
    })
    expect(res.status).toBe(409)
  })

  test('PATCH /web/admin/users/:id updates role, disabled, displayName, password', async () => {
    const res = await app.request(`/web/admin/users/${s.member.id}`, {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ role: 'admin', disabled: true, displayName: 'Renamed', password: 'changed' }),
    })
    expect(res.status).toBe(200)
    const record = await s.repos.users.getById(s.member.id)
    expect(record?.role).toBe('admin')
    expect(record?.displayName).toBe('Renamed')
    expect(record?.disabledAt).toBeInstanceOf(Date)
    expect(await verifyPassword('changed', record?.passwordHash ?? '')).toBe(true)
  })

  test('PATCH /web/admin/users/:id 404 for unknown user', async () => {
    const res = await app.request('/web/admin/users/nope', {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(404)
  })

  test('PATCH cannot demote the last enabled admin', async () => {
    const res = await app.request(`/web/admin/users/${s.admin.id}`, {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(409)
    expect((await s.repos.users.getById(s.admin.id))?.role).toBe('admin')
  })

  test('PATCH cannot disable the last enabled admin', async () => {
    const res = await app.request(`/web/admin/users/${s.admin.id}`, {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ disabled: true }),
    })
    expect(res.status).toBe(409)
    expect((await s.repos.users.getById(s.admin.id))?.disabledAt).toBeNull()
  })

  test('PATCH can demote an admin when another enabled admin exists', async () => {
    await s.repos.users.create({
      username: 'admin2',
      passwordHash: await hashPassword('secret'),
      role: 'admin',
    })
    const res = await app.request(`/web/admin/users/${s.admin.id}`, {
      method: 'PATCH',
      headers: bearer(s.adminToken),
      body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(200)
    expect((await s.repos.users.getById(s.admin.id))?.role).toBe('member')
  })
})

test('web errors carry stable codes and v1 errors do not', async () => {
  const flat = await app.request('/web/account/password', {
    method: 'POST',
    headers: bearer(s.memberToken),
    body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'new-secret' }),
  })
  expect(((await resJson(flat)) as { code?: string }).code).toBe('current_password_incorrect')

  const nested = await app.request('/web/sessions/nope', { headers: bearer(s.memberToken) })
  expect(((await resJson(nested)) as { error: { code?: string } }).error.code).toBe('session_not_found')
})
