import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { readCredentials } from '../src/credentials'
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

  test('pairs when no key is configured and persists the credential', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'rcs-pairing-'))
    const rcs = new FakeRcs('cse_pair')
    rcs.start()
    rcs.deviceTokenStates.push({ status: 'approved', api_key: 'rcs_paired', prefix: 'rcs_paired', name: 'dsh @ mac' })
    const ctx = new FakeContext()
    const previousKey = process.env.RCS_API_KEY
    delete process.env.RCS_API_KEY
    try {
      await apply(
        ctx,
        { rcsBaseUrl: rcs.origin, workdir: '/tmp', provider: 'p', model: 'm' },
        { stateDir, openUrl: () => {} },
      )
      await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'heartbeat')
      expect(ctx.effectCount).toBe(1)
      expect(rcs.deviceCodeRequests).toHaveLength(1)
      expect(await readCredentials(stateDir)).toMatchObject({ apiKey: 'rcs_paired', rcsBaseUrl: rcs.origin })
      await ctx.dispose()
    } finally {
      if (previousKey === undefined) delete process.env.RCS_API_KEY
      else process.env.RCS_API_KEY = previousKey
      rcs.stop()
    }
  }, 15000)

  test('does not touch the device endpoints when a key is configured', async () => {
    const rcs = new FakeRcs('cse_nopair')
    rcs.start()
    const ctx = new FakeContext()
    try {
      await apply(ctx, { apiKey: 'test-key', rcsBaseUrl: rcs.origin, workdir: '/tmp', provider: 'p', model: 'm' })
      await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'heartbeat')
      expect(rcs.deviceCodeRequests).toHaveLength(0)
      expect(rcs.deviceTokenStates).toHaveLength(0)
      await ctx.dispose()
    } finally {
      rcs.stop()
    }
  }, 15000)
})
