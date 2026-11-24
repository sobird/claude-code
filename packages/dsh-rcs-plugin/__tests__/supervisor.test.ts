import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import type { ResolvedConfig } from '../src/config'
import { startSupervisor } from '../src/supervisor'
import { FakeContext } from './helpers/fake-ctx'

function envConfig(origin: string): ResolvedConfig {
  return {
    rcsBaseUrl: origin,
    apiKey: 'test-key',
    workdir: '/tmp/rcs-work',
    sessionTitle: undefined,
    provider: 'test-provider',
    model: 'test-model',
    sessionId: undefined,
    mode: 'environment',
    environmentId: undefined,
    maxSessions: 2,
  }
}

describe('environment supervisor', () => {
  let previousDshHome: string | undefined

  beforeEach(async () => {
    previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'rcs-supervisor-'))
  })

  afterEach(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  test('a work item starts one bridge and acks it', async () => {
    const rcs = new FakeRcs('cse_a')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_a')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_a') ? true : undefined), 'bridge start')
      expect(rcs.acked).toHaveLength(1)
      await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('duplicate delivery does not create a second bridge', async () => {
    const rcs = new FakeRcs('cse_a')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_a')
      rcs.enqueueWork('cse_a')
      await waitFor(() => (supervisor.bridgeIds().length === 1 ? true : undefined), 'single bridge')
      await Bun.sleep(100)
      expect(supervisor.bridgeIds()).toEqual(['cse_a'])
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('a 401 during poll re-registers and keeps working', async () => {
    const rcs = new FakeRcs('cse_b')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.nextPollStatus = 401
      await waitFor(() => (rcs.environmentRegistrations.length >= 2 ? true : undefined), 're-register')
      rcs.enqueueWork('cse_b')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_b') ? true : undefined), 'work after re-register')
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)
})
