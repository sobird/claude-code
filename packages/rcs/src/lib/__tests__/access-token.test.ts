import { afterAll, beforeAll, expect, test } from 'bun:test'

import { verifyAccessToken } from '@/auth/tokens'
import { createMemoryRepositories } from '@/db/repositories'
import { ACCESS_TOKEN_TTL_SECONDS, createAccessTokenForSession, mintAccessTokenForSession } from '@/lib/access-token'

const previousSecret = process.env.RCS_AUTH_SECRET

beforeAll(() => {
  process.env.RCS_AUTH_SECRET = 'test-access-token-secret'
})

afterAll(() => {
  if (previousSecret === undefined) delete process.env.RCS_AUTH_SECRET
  else process.env.RCS_AUTH_SECRET = previousSecret
})

test('access token carries the session user', async () => {
  const token = await createAccessTokenForSession({ user: { id: 'u1', name: 'alice', role: 'admin' } })
  expect(await verifyAccessToken(token)).toEqual({ sub: 'u1', username: 'alice', role: 'admin' })
})

test('access token expires after five minutes', async () => {
  expect(ACCESS_TOKEN_TTL_SECONDS).toBe(300)
  const token = await createAccessTokenForSession({ user: { id: 'u2', name: 'bob', role: 'member' } })
  const [, payload] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    iat: number
    exp: number
  }
  expect(claims.exp - claims.iat).toBe(300)
})

test('rejects sessions without a user id', async () => {
  const noId = await createAccessTokenForSession({ user: { name: 'alice', role: 'admin' } }).catch(
    (error: unknown) => error,
  )
  expect(noId).toBeInstanceOf(Error)

  const noSession = await createAccessTokenForSession(null).catch((error: unknown) => error)
  expect(noSession).toBeInstanceOf(Error)
})

test('rejects sessions without a known role', async () => {
  const badRole = await createAccessTokenForSession({
    user: { id: 'u1', name: 'alice', role: 'owner' as never },
  }).catch((error: unknown) => error)
  expect(badRole).toBeInstanceOf(Error)
})

test('mints a token for an active user', async () => {
  const repos = createMemoryRepositories()
  const user = await repos.users.create({ username: 'carol', passwordHash: 'hash', role: 'member' })

  const token = await mintAccessTokenForSession({ user: { id: user.id, name: user.username, role: user.role } }, repos)

  expect(typeof token).toBe('string')
  expect(await verifyAccessToken(token as string)).toEqual({ sub: user.id, username: 'carol', role: 'member' })
})

test('refuses to mint for a disabled user', async () => {
  const repos = createMemoryRepositories()
  const user = await repos.users.create({ username: 'dave', passwordHash: 'hash', role: 'member' })
  await repos.users.setDisabled(user.id, new Date())

  const token = await mintAccessTokenForSession({ user: { id: user.id, name: user.username, role: user.role } }, repos)

  expect(token).toBeNull()
})

test('refuses to mint when the user no longer exists', async () => {
  const repos = createMemoryRepositories()

  const token = await mintAccessTokenForSession({ user: { id: 'missing', name: 'ghost', role: 'member' } }, repos)

  expect(token).toBeNull()
})

test('refuses to mint for a session without a user id', async () => {
  const repos = createMemoryRepositories()

  expect(await mintAccessTokenForSession(null, repos)).toBeNull()
  expect(await mintAccessTokenForSession({ user: { name: 'ghost', role: 'member' } }, repos)).toBeNull()
})
