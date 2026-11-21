import { expect, test } from 'bun:test'

import {
  signAccessToken,
  signEnvironmentToken,
  signWorkerToken,
  verifyAccessToken,
  verifyEnvironmentToken,
  verifyWorkerToken,
} from '@/auth/tokens'

process.env.RCS_AUTH_SECRET = 'test-secret'

test('access token round-trip and role', async () => {
  const token = await signAccessToken({ id: 'u1', username: 'alice', role: 'admin' }, 60)
  expect(await verifyAccessToken(token)).toEqual({ sub: 'u1', username: 'alice', role: 'admin' })
})

test('expired and tampered tokens are rejected', async () => {
  const short = await signAccessToken({ id: 'u1', username: 'alice', role: 'member' }, -1)
  expect(await verifyAccessToken(short)).toBeNull()
  expect(await verifyAccessToken('not-a-token')).toBeNull()
})

test('environment and worker tokens carry their ids', async () => {
  const env = await verifyEnvironmentToken(await signEnvironmentToken('env_1', 'u1'))
  expect(env).toEqual({ environmentId: 'env_1', userId: 'u1' })
  const worker = await verifyWorkerToken(await signWorkerToken('cse_1'))
  expect(worker).toEqual({ sessionId: 'cse_1' })
})
