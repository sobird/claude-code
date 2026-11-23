import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import type { AppEnv } from '@/auth/context'
import { hashPassword } from '@/auth/password'
import { signAccessToken } from '@/auth/tokens'
import { loadConfig } from '@/config'
import type { UserRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import webPush from '@/routes/web/push'
import { initPushNotifier, resetPushNotifierForTests, type PushNotifierProvider } from '@/services/push-notifier'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'test-api-key'
process.env.RCS_BASE_URL = 'http://localhost:3000'

function resJson(res: Response) {
  return res.json()
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function fakeProvider(): PushNotifierProvider {
  return {
    setVapidDetails: () => {},
    generateVapidKeys: () => ({ publicKey: 'generated-pub', privateKey: 'generated-priv' }),
    async sendNotification() {},
  }
}

function pushConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    RCS_AUTH_SECRET: 'test-secret',
    RCS_VAPID_PUBLIC_KEY: 'pub',
    RCS_VAPID_PRIVATE_KEY: 'priv',
    ...overrides,
  } as unknown as NodeJS.ProcessEnv)
}

interface Seed {
  repos: Repositories
  member: UserRecord
  other: UserRecord
  memberToken: string
  otherToken: string
}

async function seed(): Promise<Seed> {
  const repos = await createTestRepositories()
  const passwordHash = await hashPassword('secret')
  const member = await repos.users.create({ username: 'member', passwordHash, role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash, role: 'member' })
  const tokenFor = (user: UserRecord) => signAccessToken({ id: user.id, username: user.username, role: user.role })
  return { repos, member, other, memberToken: await tokenFor(member), otherToken: await tokenFor(other) }
}

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/web', webPush)
  return app
}

let s: Seed
let app: Hono<AppEnv>

beforeEach(async () => {
  resetPushNotifierForTests()
  s = await seed()
  app = createApp(s.repos)
})

describe('Web Push Routes', () => {
  test('GET /web/push/config requires auth', async () => {
    const res = await app.request('/web/push/config')
    expect(res.status).toBe(401)
  })

  test('GET /web/push/config returns the enabled public config after init', async () => {
    await initPushNotifier({ config: pushConfig(), repos: s.repos, provider: fakeProvider() })
    const res = await app.request('/web/push/config', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect(await resJson(res)).toEqual({ enabled: true, publicKey: 'pub' })
  })

  test('GET /web/push/config reports disabled before init', async () => {
    const res = await app.request('/web/push/config', { headers: bearer(s.memberToken) })
    expect(res.status).toBe(200)
    expect(await resJson(res)).toEqual({ enabled: false, publicKey: null })
  })

  test('POST /web/push/subscriptions stores the subscription for the caller', async () => {
    const res = await app.request('/web/push/subscriptions', {
      method: 'POST',
      headers: { ...bearer(s.memberToken), 'User-Agent': 'test-agent' },
      body: JSON.stringify({
        endpoint: 'https://push.example/a',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      }),
    })
    expect(res.status).toBe(204)

    const rows = await s.repos.pushSubscriptions.listByUser(s.member.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.endpoint).toBe('https://push.example/a')
    expect(rows[0]?.p256dh).toBe('p256dh-value')
    expect(rows[0]?.auth).toBe('auth-value')
    expect(rows[0]?.userAgent).toBe('test-agent')
  })

  test('POST /web/push/subscriptions rejects a body missing keys.auth', async () => {
    const res = await app.request('/web/push/subscriptions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({ endpoint: 'https://push.example/a', keys: { p256dh: 'p256dh-value' } }),
    })
    expect(res.status).toBe(400)
    const body = await resJson(res)
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('invalid_subscription')
    expect(await s.repos.pushSubscriptions.listByUser(s.member.id)).toHaveLength(0)
  })

  test('POST /web/push/subscriptions rejects a non-HTTPS endpoint and stores nothing', async () => {
    const res = await app.request('/web/push/subscriptions', {
      method: 'POST',
      headers: bearer(s.memberToken),
      body: JSON.stringify({
        endpoint: 'http://fcm.googleapis.com/x',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      }),
    })
    expect(res.status).toBe(400)
    const body = await resJson(res)
    expect(body.code).toBe('invalid_subscription')
    expect(await s.repos.pushSubscriptions.listByUser(s.member.id)).toHaveLength(0)
  })

  test('DELETE /web/push/subscriptions removes only the caller row for the endpoint', async () => {
    const endpoint = 'https://push.example/e?x=1'
    // The caller subscribes, then another account signs in on the same browser and the
    // endpoint is reassigned to them. Deleting as the original caller must not remove it.
    await s.repos.pushSubscriptions.upsertForUser(s.member.id, { endpoint, p256dh: 'p', auth: 'a' })
    await s.repos.pushSubscriptions.upsertForUser(s.other.id, { endpoint, p256dh: 'p', auth: 'a' })

    const res = await app.request(`/web/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(204)

    expect(await s.repos.pushSubscriptions.listByUser(s.member.id)).toHaveLength(0)
    const otherRows = await s.repos.pushSubscriptions.listByUser(s.other.id)
    expect(otherRows).toHaveLength(1)
    expect(otherRows[0]?.endpoint).toBe(endpoint)

    // The owning account can still remove its own row.
    const ownerRes = await app.request(`/web/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: bearer(s.otherToken),
    })
    expect(ownerRes.status).toBe(204)
    expect(await s.repos.pushSubscriptions.listByUser(s.other.id)).toHaveLength(0)
  })

  test('DELETE /web/push/subscriptions requires an endpoint', async () => {
    const res = await app.request('/web/push/subscriptions', {
      method: 'DELETE',
      headers: bearer(s.memberToken),
    })
    expect(res.status).toBe(400)
    const body = await resJson(res)
    expect(body.code).toBe('endpoint_required')
  })
})
