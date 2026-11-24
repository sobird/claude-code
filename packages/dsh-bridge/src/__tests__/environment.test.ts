import { describe, expect, test } from 'bun:test'

import { parseWorkSecret, RcsEnvironmentClient, toWorkerSession } from '../environment'
import { FakeRcs } from '../testing/fake-rcs'

describe('RcsEnvironmentClient', () => {
  test('register sends the environment payload', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    try {
      const env = new RcsEnvironmentClient({ baseUrl: rcs.origin, apiKey: 'k' })
      const result = await env.register({ machineName: 'm', directory: '/w', maxSessions: 4, workerType: 'deepseek' })
      expect(result.environmentId).toBe('env_test')
      expect(rcs.environmentRegistrations[0]).toMatchObject({
        machine_name: 'm',
        directory: '/w',
        max_sessions: 4,
        metadata: { worker_type: 'deepseek' },
      })
    } finally {
      rcs.stop()
    }
  })

  test('poll returns null on 204 and a work item otherwise', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    try {
      const env = new RcsEnvironmentClient({ baseUrl: rcs.origin, apiKey: 'k' })
      expect(await env.poll('env_test', 'es')).toBeNull()
      rcs.enqueueWork('cse_x')
      const item = await env.poll('env_test', 'es')
      if (!item) throw new Error('expected a work item')
      expect(item).toMatchObject({ sessionId: 'cse_x' })
      const parsed = parseWorkSecret(item.secret)
      expect(parsed.sessionIngressToken).toBe('work-jwt')
      expect(toWorkerSession(item, rcs.origin).sessionId).toBe('cse_x')
    } finally {
      rcs.stop()
    }
  })

  test('ack, stop and deregister hit their endpoints', async () => {
    const rcs = new FakeRcs('cse_x')
    rcs.start()
    try {
      const env = new RcsEnvironmentClient({ baseUrl: rcs.origin, apiKey: 'k' })
      await env.ack('env_test', 'work_1', 'work-jwt')
      await env.stop('env_test', 'work_1', 'env_secret')
      await env.reconnect('env_test')
      await env.deregister('env_test')
      expect(rcs.acked).toEqual(['work_1'])
      expect(rcs.stopped).toEqual(['work_1'])
      expect(rcs.reconnected).toEqual(['env_test'])
      expect(rcs.deregistered).toEqual(['env_test'])
    } finally {
      rcs.stop()
    }
  })
})
