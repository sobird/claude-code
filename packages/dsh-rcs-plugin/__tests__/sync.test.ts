import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RcsClient } from '@sobird/dsh-bridge/core'
import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import type { ResolvedConfig } from '../src/config'
import { startSupervisor, type SessionSupervisor } from '../src/supervisor'
import { syncSession } from '../src/sync'
import { FakeAgent, FakeContext } from './helpers/fake-ctx'

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

type SyncDeps = Parameters<typeof syncSession>[0]

describe('rcs-sync', () => {
  let rcs: FakeRcs
  let ctx: FakeContext
  let supervisor: SessionSupervisor
  let deps: SyncDeps
  let previousDshHome: string | undefined

  beforeEach(async () => {
    previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'rcs-sync-'))
    rcs = new FakeRcs('cse_test')
    rcs.start()
    ctx = new FakeContext()
    const config = envConfig(rcs.origin)
    supervisor = await startSupervisor(ctx, config, { emptyPollDelayMs: 20 })
    deps = { ctx, supervisor, config, rcs: new RcsClient({ baseUrl: rcs.origin, apiKey: 'test-key' }) }
  })

  afterEach(async () => {
    await supervisor.dispose()
    rcs.stop()
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  test('syncs a dsh session and is idempotent', async () => {
    ctx.agents.live.set('session-local', new FakeAgent('session-local'))
    const first = await syncSession(deps, 'session-local')
    expect(first.kind).toBe('success')
    expect(rcs.createdSessions).toHaveLength(1)
    expect(rcs.createdSessions[0]).toMatchObject({ environment_id: 'env_test', title: 'session-local' })
    expect(supervisor.bridgeIds()).toContain('cse_test')

    const second = await syncSession(deps, 'session-local')
    expect(second.kind).toBe('success')
    expect(rcs.createdSessions).toHaveLength(1)
  }, 15000)

  test('routes dsh events through the agent id, not the rcs id', async () => {
    ctx.agents.live.set('session-local', new FakeAgent('session-local'))
    await syncSession(deps, 'session-local')
    ctx.emitSessionEvent('session-local', {
      type: 'assistant/message',
      seq: 1,
      data: { message: { content: [{ type: 'text', text: 'hi' }] } },
    })
    await waitFor(() => rcs.events.find((event) => event.type === 'assistant'), 'assistant event')
  }, 15000)

  test('a cse session is already in rcs', async () => {
    const result = await syncSession(deps, 'cse_existing')
    expect(result).toMatchObject({ kind: 'success' })
    expect(rcs.createdSessions).toHaveLength(0)
  })
})
