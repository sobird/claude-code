import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import type { AppEnv } from '@/auth/context'
import { hashPassword } from '@/auth/password'
import { signAccessToken } from '@/auth/tokens'
import { toWebSessionId } from '@/contracts'
import type { SessionRecord, UserRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import webSessions from '@/routes/web/sessions'
import { connectPresence, isSessionVisible, resetPresenceForTests, setPresenceVisible } from '@/services/presence'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'test-api-key'
process.env.RCS_BASE_URL = 'http://localhost:3000'

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

interface Seed {
  repos: Repositories
  owner: UserRecord
  other: UserRecord
  ownerToken: string
  otherToken: string
  session: SessionRecord
}

async function seed(): Promise<Seed> {
  const repos = await createTestRepositories()
  const passwordHash = await hashPassword('secret')
  const owner = await repos.users.create({ username: 'owner', passwordHash, role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash, role: 'member' })
  const session = await repos.sessions.create({ ownerUserId: owner.id, title: 'Presence' })
  const tokenFor = (user: UserRecord) => signAccessToken({ id: user.id, username: user.username, role: user.role })
  return {
    repos,
    owner,
    other,
    ownerToken: await tokenFor(owner),
    otherToken: await tokenFor(other),
    session,
  }
}

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/web', webSessions)
  return app
}

let s: Seed
let app: Hono<AppEnv>

beforeEach(async () => {
  resetPresenceForTests()
  s = await seed()
  app = createApp(s.repos)
})

describe('Web session presence routes', () => {
  test('POST presence requires auth', async () => {
    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/presence`, {
      method: 'POST',
      body: JSON.stringify({ client_id: 'c1', visible: true }),
    })
    expect(res.status).toBe(401)
  })

  test('POST presence updates a connected client of the owned session', async () => {
    const release = connectPresence(s.session.id, 'c1')

    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/presence`, {
      method: 'POST',
      headers: bearer(s.ownerToken),
      body: JSON.stringify({ client_id: 'c1', visible: true }),
    })

    expect(res.status).toBe(204)
    expect(isSessionVisible(s.session.id)).toBe(true)
    release()
  })

  test('POST presence forbids another user’s session', async () => {
    const release = connectPresence(s.session.id, 'c1')

    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/presence`, {
      method: 'POST',
      headers: bearer(s.otherToken),
      body: JSON.stringify({ client_id: 'c1', visible: true }),
    })

    expect(res.status).toBe(403)
    release()
  })

  test('POST presence rejects a missing client id', async () => {
    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/presence`, {
      method: 'POST',
      headers: bearer(s.ownerToken),
      body: JSON.stringify({ visible: true }),
    })

    expect(res.status).toBe(400)
  })

  test('opening the SSE stream registers the client and closing it releases it', async () => {
    const controller = new AbortController()
    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/events?client_id=c1`, {
      headers: bearer(s.ownerToken),
      signal: controller.signal,
    })

    expect(res.status).toBe(200)
    // `setPresenceVisible` only accepts known clients, so a `true` here proves
    // the stream registered `c1` with the route's canonical session id.
    expect(setPresenceVisible(s.session.id, 'c1', true)).toBe(true)

    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setPresenceVisible(s.session.id, 'c1', true)).toBe(false)
  })

  test('an SSE stream without a client id registers nothing', async () => {
    const controller = new AbortController()
    const res = await app.request(`/web/sessions/${toWebSessionId(s.session.id)}/events`, {
      headers: bearer(s.ownerToken),
      signal: controller.signal,
    })

    expect(res.status).toBe(200)
    expect(setPresenceVisible(s.session.id, 'c1', true)).toBe(false)

    controller.abort()
  })
})
