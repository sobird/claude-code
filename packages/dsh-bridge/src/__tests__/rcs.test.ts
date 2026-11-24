import { describe, expect, test } from 'bun:test'

import { RcsClient, RcsHttpError } from '../rcs'
import { FakeRcs } from '../testing/fake-rcs'

describe('RcsClient', () => {
  test('non-2xx throws RcsHttpError with status', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    rcs.failCreate = true
    const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
    const error = await client.createSession(undefined).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RcsHttpError)
    if (!(error instanceof RcsHttpError)) throw new Error('expected RcsHttpError')
    expect(error.status).toBe(500)
    rcs.stop()
  })

  test('createSession sends environment_id when given', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
    await client.createSession('t', 'env_1')
    expect(rcs.createdSessions).toEqual([{ title: 't', environment_id: 'env_1' }])
    rcs.stop()
  })

  test('setExternalMetadata PUTs the blob', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
    const worker = {
      sessionId: 'cse_x',
      apiBaseUrl: rcs.origin,
      workerJwt: 'w',
      workerEpoch: 1,
      expiresAt: Date.now() + 60_000,
    }
    await client.setExternalMetadata(worker, { dsh_session_id: 'session-x' })
    expect(rcs.externalMetadata).toEqual([{ dsh_session_id: 'session-x' }])
    rcs.stop()
  })
})
