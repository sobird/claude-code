import { afterAll, beforeAll, expect, test } from 'bun:test'

import { verifyAccessToken } from '../../auth/tokens.js'
import { ACCESS_TOKEN_TTL_SECONDS, createAccessTokenForSession } from '../access-token.js'

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
