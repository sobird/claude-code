import { expect, test } from 'bun:test'

import { SignJWT } from 'jose'

import {
  signAccessToken,
  signEnvironmentToken,
  signWorkerToken,
  verifyAccessToken,
  verifyEnvironmentToken,
  verifyWorkerToken,
} from '../tokens.js'

const SECRET = 'edge-test-secret'
process.env.RCS_AUTH_SECRET = SECRET

async function withSecret<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.RCS_AUTH_SECRET
  try {
    if (value === undefined) delete process.env.RCS_AUTH_SECRET
    else process.env.RCS_AUTH_SECRET = value
    return await run()
  } finally {
    if (previous === undefined) delete process.env.RCS_AUTH_SECRET
    else process.env.RCS_AUTH_SECRET = previous
  }
}

test('signing throws and verification returns null when the secret is missing', async () => {
  await withSecret(undefined, async () => {
    let message = ''
    try {
      await signAccessToken({ id: 'u1', username: 'alice', role: 'admin' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('RCS_AUTH_SECRET')
    expect(await verifyAccessToken('anything')).toBeNull()
  })
})

test('tokens are bound to their audience', async () => {
  const access = await signAccessToken({ id: 'u1', username: 'alice', role: 'admin' }, 60)
  expect(await verifyEnvironmentToken(access)).toBeNull()
  expect(await verifyWorkerToken(access)).toBeNull()

  const environment = await signEnvironmentToken('env_1', 'u1', 60)
  expect(await verifyWorkerToken(environment)).toBeNull()
})

test('access tokens with unexpected roles are rejected', async () => {
  const token = await new SignJWT({ username: 'alice', role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('rcs')
    .setAudience('rcs-api')
    .setSubject('u1')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
    .sign(new TextEncoder().encode(SECRET))

  expect(await verifyAccessToken(token)).toBeNull()
})

test('tokens signed with a different secret are rejected', async () => {
  const token = await withSecret('another-secret', () => signWorkerToken('cse_1', 60))
  expect(await verifyWorkerToken(token)).toBeNull()
})
