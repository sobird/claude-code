import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

import type { UserRecord } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import { generateApiKey, hashApiKey } from '../api-key.js'
import type { AppEnv } from '../context.js'
import { encodeWebSocketAuthProtocol, extractBearerToken, extractWebSocketAuthToken } from '../context.js'
import { webCorsOptions } from '../cors.js'
import {
  accessTokenAuth,
  apiKeyAuth,
  createApiKeyAuth,
  createUserAuth,
  environmentAuth,
  requireAdmin,
  sessionIngressAuth,
  userAuth,
} from '../middleware.js'
import { signAccessToken, signEnvironmentToken, signWorkerToken } from '../tokens.js'

process.env.RCS_AUTH_SECRET = 'test-secret'

interface Seed {
  repos: Repositories
  admin: UserRecord
  member: UserRecord
  other: UserRecord
  disabled: UserRecord
  validKeyRaw: string
  revokedKeyRaw: string
  disabledKeyRaw: string
  adminKeyRaw: string
  otherKeyRaw: string
  memberEnvId: string
  adminEnvId: string
  sessionId: string
  unownedSessionId: string
}

async function seed(): Promise<Seed> {
  const repos = createMemoryRepositories()
  const admin = await repos.users.create({ username: 'admin', passwordHash: 'x', role: 'admin' })
  const member = await repos.users.create({ username: 'member', passwordHash: 'x', role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash: 'x', role: 'member' })
  const disabled = await repos.users.create({ username: 'disabled', passwordHash: 'x', role: 'member' })
  await repos.users.setDisabled(disabled.id, new Date())

  async function issue(userId: string, name: string): Promise<string> {
    const generated = generateApiKey()
    await repos.apiKeys.create({ userId, name, prefix: generated.prefix, hash: generated.hash })
    return generated.raw
  }

  const validKeyRaw = await issue(member.id, 'member-cli')
  const revokedKeyRaw = await issue(member.id, 'revoked')
  const disabledKeyRaw = await issue(disabled.id, 'disabled-cli')
  const adminKeyRaw = await issue(admin.id, 'admin-cli')
  const otherKeyRaw = await issue(other.id, 'other-cli')

  for (const raw of [revokedKeyRaw]) {
    const record = await repos.apiKeys.getByHash(hashApiKey(raw))
    if (record) await repos.apiKeys.revoke(record.id, new Date())
  }

  const memberEnv = await repos.environments.create({ ownerUserId: member.id })
  const adminEnv = await repos.environments.create({ ownerUserId: admin.id })
  const session = await repos.sessions.create({ id: 'cse_match', environmentId: memberEnv.id, ownerUserId: member.id })
  const unowned = await repos.sessions.create({ id: 'cse_unowned', environmentId: memberEnv.id, ownerUserId: null })

  return {
    repos,
    admin,
    member,
    other,
    disabled,
    validKeyRaw,
    revokedKeyRaw,
    disabledKeyRaw,
    adminKeyRaw,
    otherKeyRaw,
    memberEnvId: memberEnv.id,
    adminEnvId: adminEnv.id,
    sessionId: session.id,
    unownedSessionId: unowned.id,
  }
}

let s: Seed

beforeEach(async () => {
  s = await seed()
})

function appWith(middleware: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', s.repos)
    await next()
  })
  app.get('/', middleware, (c) => c.json({ user: c.get('user'), environment: c.get('environment')?.id ?? null }))
  return app
}

function chainApp(...middleware: MiddlewareHandler<AppEnv>[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', s.repos)
    await next()
  })
  for (const handler of middleware) {
    app.use('*', handler)
  }
  app.get('/', (c) => c.json({ user: c.get('user') }))
  return app
}

function envApp(middleware: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', s.repos)
    await next()
  })
  app.get('/environments/:id', middleware, (c) =>
    c.json({ environment: c.get('environment').id, user: c.get('user')?.id ?? null }),
  )
  return app
}

function sessionApp(middleware: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', s.repos)
    await next()
  })
  app.get('/sessions/:id', middleware, (c) => c.json({ workerSessionId: c.get('workerSessionId') }))
  return app
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

describe('extractBearerToken', () => {
  function headerApp(): Hono<AppEnv> {
    const app = new Hono<AppEnv>()
    app.get('/', (c) => c.json({ token: extractBearerToken(c) }))
    return app
  }

  test('reads a case-insensitive Bearer header', async () => {
    const res = await headerApp().request('/', { headers: { Authorization: 'bearer abc.def' } })
    expect(await res.json()).toEqual({ token: 'abc.def' })
  })

  test('ignores the query string', async () => {
    const res = await headerApp().request('/?token=leaked')
    expect(await res.json()).toEqual({ token: null })
  })
})

describe('extractWebSocketAuthToken', () => {
  function wsApp(): Hono<AppEnv> {
    const app = new Hono<AppEnv>()
    app.get('/', (c) => c.json({ token: extractWebSocketAuthToken(c) }))
    return app
  }

  test('decodes the rcs.auth subprotocol', async () => {
    const protocol = encodeWebSocketAuthProtocol('jwt-value')
    const res = await wsApp().request('/', { headers: { 'Sec-WebSocket-Protocol': `chat, ${protocol}` } })
    expect(await res.json()).toEqual({ token: 'jwt-value' })
  })

  test('prefers the Authorization header over the subprotocol', async () => {
    const res = await wsApp().request('/', {
      headers: { Authorization: 'Bearer head', 'Sec-WebSocket-Protocol': encodeWebSocketAuthProtocol('proto') },
    })
    expect(await res.json()).toEqual({ token: 'head' })
  })

  test('never reads tokens from the query string', async () => {
    const res = await wsApp().request('/?token=leaked')
    expect(await res.json()).toEqual({ token: null })
  })
})

describe('accessTokenAuth', () => {
  test('sets the user for a valid access token', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    const res = await appWith(accessTokenAuth).request('/', { headers: bearer(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toEqual({ id: s.member.id, username: 'member', role: 'member' })
  })

  test('accepts a valid token from the WebSocket subprotocol', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    const res = await appWith(accessTokenAuth).request('/', {
      headers: { 'Sec-WebSocket-Protocol': encodeWebSocketAuthProtocol(token) },
    })
    expect(res.status).toBe(200)
  })

  test('rejects a missing or invalid token with 401', async () => {
    expect((await appWith(accessTokenAuth).request('/')).status).toBe(401)
    const res = await appWith(accessTokenAuth).request('/', { headers: bearer('invalid') })
    expect(res.status).toBe(401)
  })

  test('does not accept a token supplied only via the query string', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    const res = await appWith(accessTokenAuth).request(`/?token=${encodeURIComponent(token)}`)
    expect(res.status).toBe(401)
  })
})

describe('apiKeyAuth', () => {
  test('resolves the owning user and touches the key', async () => {
    const res = await appWith(apiKeyAuth).request('/', { headers: bearer(s.validKeyRaw) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toEqual({ id: s.member.id, username: 'member', role: 'member' })
    const stored = await s.repos.apiKeys.getByHash(hashApiKey(s.validKeyRaw))
    expect(stored?.lastUsedAt).not.toBeNull()
  })

  test('rejects unknown, revoked, and disabled-user keys with 401', async () => {
    for (const raw of ['rcs_unknown', s.revokedKeyRaw, s.disabledKeyRaw]) {
      const res = await appWith(apiKeyAuth).request('/', { headers: bearer(raw) })
      expect(res.status).toBe(401)
    }
  })

  test('an access token is not accepted as an API key', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    const res = await appWith(apiKeyAuth).request('/', { headers: bearer(token) })
    expect(res.status).toBe(401)
  })
})

describe('legacy keys and the user credential chain', () => {
  const legacy = 'legacy-bootstrap-key'

  test('a factory-configured legacy key maps to the first admin', async () => {
    const res = await appWith(createApiKeyAuth({ legacyKeys: [legacy] })).request('/', { headers: bearer(legacy) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toEqual({ id: s.admin.id, username: 'admin', role: 'admin' })
  })

  test('legacy keys are rejected when the user API-key lookup and no admin exist', async () => {
    const repos = createMemoryRepositories()
    await repos.users.create({ username: 'member', passwordHash: 'x', role: 'member' })
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('repos', repos)
      await next()
    })
    app.get('/', createApiKeyAuth({ legacyKeys: [legacy] }), (c) => c.json({ ok: true }))
    const res = await app.request('/', { headers: bearer(legacy) })
    expect(res.status).toBe(401)
  })

  test('the chain accepts access token, user API key, and legacy key', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    const app = appWith(createUserAuth({ legacyKeys: [legacy] }))
    expect((await app.request('/', { headers: bearer(token) })).status).toBe(200)
    expect((await app.request('/', { headers: bearer(s.validKeyRaw) })).status).toBe(200)
    const legacyRes = await app.request('/', { headers: bearer(legacy) })
    expect(legacyRes.status).toBe(200)
    expect((await legacyRes.json()).user.id).toBe(s.admin.id)
  })

  test('the default userAuth accepts access token and API key but not legacy', async () => {
    const token = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    expect((await appWith(userAuth).request('/', { headers: bearer(token) })).status).toBe(200)
    expect((await appWith(userAuth).request('/', { headers: bearer(s.validKeyRaw) })).status).toBe(200)
    expect((await appWith(userAuth).request('/', { headers: bearer(legacy) })).status).toBe(401)
  })
})

describe('requireAdmin', () => {
  test('allows admins and rejects members and anonymous callers', async () => {
    const adminToken = await signAccessToken({ id: s.admin.id, username: 'admin', role: 'admin' })
    expect((await chainApp(accessTokenAuth, requireAdmin).request('/', { headers: bearer(adminToken) })).status).toBe(
      200,
    )

    const memberToken = await signAccessToken({ id: s.member.id, username: 'member', role: 'member' })
    expect((await chainApp(accessTokenAuth, requireAdmin).request('/', { headers: bearer(memberToken) })).status).toBe(
      403,
    )

    expect((await chainApp(accessTokenAuth, requireAdmin).request('/')).status).toBe(401)
  })
})

describe('environmentAuth', () => {
  test('accepts a matching environment token and sets the environment', async () => {
    const token = await signEnvironmentToken(s.memberEnvId, s.member.id)
    const res = await envApp(environmentAuth).request(`/environments/${s.memberEnvId}`, { headers: bearer(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.environment).toBe(s.memberEnvId)
  })

  test('rejects an environment token for a different route id with 403', async () => {
    const token = await signEnvironmentToken(s.adminEnvId, s.admin.id)
    const res = await envApp(environmentAuth).request(`/environments/${s.memberEnvId}`, { headers: bearer(token) })
    expect(res.status).toBe(403)
  })

  test('returns 404 when the environment does not exist', async () => {
    const res = await envApp(environmentAuth).request('/environments/env_missing')
    expect(res.status).toBe(404)
  })

  test('accepts an owning API key and an admin API key, rejects a non-owner', async () => {
    const ownerRes = await envApp(environmentAuth).request(`/environments/${s.memberEnvId}`, {
      headers: bearer(s.validKeyRaw),
    })
    expect(ownerRes.status).toBe(200)

    const adminRes = await envApp(environmentAuth).request(`/environments/${s.memberEnvId}`, {
      headers: bearer(s.adminKeyRaw),
    })
    expect(adminRes.status).toBe(200)

    const nonOwnerRes = await envApp(environmentAuth).request(`/environments/${s.adminEnvId}`, {
      headers: bearer(s.validKeyRaw),
    })
    expect(nonOwnerRes.status).toBe(403)
  })
})

describe('sessionIngressAuth', () => {
  test('accepts a worker token for the matching canonical session id', async () => {
    const token = await signWorkerToken(s.sessionId)
    const res = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, { headers: bearer(token) })
    expect(res.status).toBe(200)
    expect((await res.json()).workerSessionId).toBe(s.sessionId)
  })

  test('maps a session_* route id to the canonical cse_* form', async () => {
    const token = await signWorkerToken('cse_match')
    const res = await sessionApp(sessionIngressAuth).request('/sessions/session_match', { headers: bearer(token) })
    expect(res.status).toBe(200)
    expect((await res.json()).workerSessionId).toBe('cse_match')
  })

  test('rejects a worker token for a different session with 403', async () => {
    const token = await signWorkerToken(s.unownedSessionId)
    const res = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, { headers: bearer(token) })
    expect(res.status).toBe(403)
  })

  test('accepts an owning API key, an admin key, and any key for an unowned session', async () => {
    const owned = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, {
      headers: bearer(s.validKeyRaw),
    })
    expect(owned.status).toBe(200)

    const admin = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, {
      headers: bearer(s.adminKeyRaw),
    })
    expect(admin.status).toBe(200)

    const unowned = await sessionApp(sessionIngressAuth).request(`/sessions/${s.unownedSessionId}`, {
      headers: bearer(s.validKeyRaw),
    })
    expect(unowned.status).toBe(200)
  })

  test('accepts an environment token whose environment is owned by the same user', async () => {
    const token = await signEnvironmentToken(s.memberEnvId, s.member.id)
    const res = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, { headers: bearer(token) })
    expect(res.status).toBe(200)
  })

  test('rejects an environment token owned by a different user with 403', async () => {
    const token = await signEnvironmentToken(s.adminEnvId, s.admin.id)
    const res = await sessionApp(sessionIngressAuth).request(`/sessions/${s.unownedSessionId}`, {
      headers: bearer(token),
    })
    expect(res.status).toBe(403)
  })

  test('rejects a non-owner member API key for an owned session with 403', async () => {
    const res = await sessionApp(sessionIngressAuth).request(`/sessions/${s.sessionId}`, {
      headers: bearer(s.otherKeyRaw),
    })
    expect(res.status).toBe(403)
  })
})

describe('webCorsOptions', () => {
  test('echoes only allowlisted origins and advertises methods and headers', async () => {
    const app = new Hono()
    app.use('*', cors(webCorsOptions(['https://ui.example.com'])))
    app.get('/', (c) => c.text('ok'))

    const allowed = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://ui.example.com', 'Access-Control-Request-Method': 'POST' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://ui.example.com')
    const methods = allowed.headers.get('access-control-allow-methods') ?? ''
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(methods).toContain(method)
    }
    const headers = (allowed.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    expect(headers).toContain('authorization')
    expect(headers).toContain('content-type')

    const blocked = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
    })
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('emits no CORS header when no origins are configured', async () => {
    const app = new Hono()
    app.use('*', cors(webCorsOptions([])))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/', { headers: { Origin: 'https://ui.example.com' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
