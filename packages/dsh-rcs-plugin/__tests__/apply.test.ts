import { describe, expect, test } from 'bun:test'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { apply, inject, name } from '../src/index'
import { FakeContext } from './helpers/fake-ctx'

describe('plugin entry', () => {
  test('declares the Cordis contract', () => {
    expect(name).toBe('rcs-bridge')
    expect(inject).toEqual(['agents', 'sessionQuery'])
  })

  test('apply starts the bridge and registers a disposer', async () => {
    const rcs = new FakeRcs('cse_apply')
    rcs.start()
    const ctx = new FakeContext()
    try {
      await apply(ctx, { apiKey: 'test-key', rcsBaseUrl: rcs.origin, workdir: '/tmp', provider: 'p', model: 'm' })
      await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'heartbeat')
      expect(ctx.effectCount).toBe(1)
      await ctx.dispose()
      await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
    } finally {
      rcs.stop()
    }
  }, 15000)
})
