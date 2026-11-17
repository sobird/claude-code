import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { hashPassword } from '../../auth/password.js'
import { signAccessToken } from '../../auth/tokens.js'
import type { UserRecord } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import { MAX_ATTACHMENT_BYTES } from '../../lib/attachments.js'
import webAttachments from '../web/attachments.js'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = ''

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface Seed {
  repos: Repositories
  memberToken: string
  otherToken: string
  adminToken: string
}

async function seed(): Promise<Seed> {
  const repos = createMemoryRepositories()
  const passwordHash = await hashPassword('secret')
  const member = await repos.users.create({ username: 'member', passwordHash, role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash, role: 'member' })
  const admin = await repos.users.create({ username: 'admin', passwordHash, role: 'admin' })
  const tokenFor = (user: UserRecord) => signAccessToken({ id: user.id, username: user.username, role: user.role })
  return {
    repos,
    memberToken: await tokenFor(member),
    otherToken: await tokenFor(other),
    adminToken: await tokenFor(admin),
  }
}

let s: Seed
let app: Hono<AppEnv>

beforeEach(async () => {
  s = await seed()
  const bound = new Hono<AppEnv>()
  bound.use('*', async (c, next) => {
    c.set('repos', s.repos)
    await next()
  })
  bound.route('/web', webAttachments)
  app = bound
})

function upload(body: Uint8Array | ArrayBuffer, token: string, contentType = 'image/png') {
  return app.request('/web/attachments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: body instanceof Uint8Array ? new Uint8Array(body).buffer : body,
  })
}

describe('POST /web/attachments', () => {
  test('stores image bytes and returns the reference', async () => {
    const res = await upload(PNG_BYTES, s.memberToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; media_type: string; byte_length: number }
    expect(body.id).toMatch(/^att_/)
    expect(body.media_type).toBe('image/png')
    expect(body.byte_length).toBe(PNG_BYTES.byteLength)
  })

  test('re-uploading identical bytes returns the same id', async () => {
    const first = (await (await upload(PNG_BYTES, s.memberToken)).json()) as { id: string }
    const second = (await (await upload(PNG_BYTES, s.memberToken)).json()) as { id: string }
    expect(second.id).toBe(first.id)
  })

  test('rejects unsupported media types', async () => {
    const res = await upload(PNG_BYTES, s.memberToken, 'application/pdf')
    expect(res.status).toBe(415)
  })

  test('rejects an empty body', async () => {
    const res = await upload(new Uint8Array(), s.memberToken)
    expect(res.status).toBe(400)
  })

  test('rejects oversized uploads', async () => {
    const res = await upload(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), s.memberToken)
    expect(res.status).toBe(413)
  })

  test('requires authentication', async () => {
    const res = await app.request('/web/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(PNG_BYTES).buffer,
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /web/attachments/:id', () => {
  async function uploadAs(token: string): Promise<string> {
    const body = (await (await upload(PNG_BYTES, token)).json()) as { id: string }
    return body.id
  }

  test('serves the bytes with an immutable cache and ETag', async () => {
    const id = await uploadAs(s.memberToken)
    const res = await app.request(`/web/attachments/${id}`, {
      headers: { Authorization: `Bearer ${s.memberToken}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(PNG_BYTES))
  })

  test('honors If-None-Match', async () => {
    const id = await uploadAs(s.memberToken)
    const first = await app.request(`/web/attachments/${id}`, {
      headers: { Authorization: `Bearer ${s.memberToken}` },
    })
    const etag = first.headers.get('etag') ?? ''
    const res = await app.request(`/web/attachments/${id}`, {
      headers: { Authorization: `Bearer ${s.memberToken}`, 'If-None-Match': etag },
    })
    expect(res.status).toBe(304)
  })

  test("hides another member's attachment", async () => {
    const id = await uploadAs(s.memberToken)
    const res = await app.request(`/web/attachments/${id}`, {
      headers: { Authorization: `Bearer ${s.otherToken}` },
    })
    expect(res.status).toBe(403)
  })

  test('admins may read any attachment', async () => {
    const id = await uploadAs(s.memberToken)
    const res = await app.request(`/web/attachments/${id}`, {
      headers: { Authorization: `Bearer ${s.adminToken}` },
    })
    expect(res.status).toBe(200)
  })

  test('returns 404 for unknown ids', async () => {
    const res = await app.request('/web/attachments/att_missing', {
      headers: { Authorization: `Bearer ${s.memberToken}` },
    })
    expect(res.status).toBe(404)
  })
})
