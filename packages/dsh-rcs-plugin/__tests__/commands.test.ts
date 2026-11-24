import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { registerCommands, runMaxSessionsCommand } from '../src/commands'
import type { ResolvedConfig } from '../src/config'
import { startSupervisor, type SessionSupervisor } from '../src/supervisor'
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

describe('rcs-max-sessions', () => {
  let rcs: FakeRcs
  let supervisor: SessionSupervisor
  let previousDshHome: string | undefined

  beforeEach(async () => {
    previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'rcs-commands-'))
    rcs = new FakeRcs('cse_a')
    rcs.start()
    supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
  })

  afterEach(async () => {
    await supervisor.dispose()
    rcs.stop()
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  test('rejects a non-positive limit without changing state', async () => {
    const result = await runMaxSessionsCommand(supervisor, '0')
    expect(result.kind).toBe('error')
    expect(supervisor.bridgeIds()).toEqual([])
  })

  test('a valid limit re-registers the environment', async () => {
    expect((await runMaxSessionsCommand(supervisor, ' 6 ')).kind).toBe('success')
    expect(rcs.environmentRegistrations.at(-1)).toMatchObject({ max_sessions: 6 })
  })

  test('lowering below live bridges keeps them', async () => {
    rcs.enqueueWork('cse_a')
    await waitFor(() => (supervisor.bridgeIds().length === 1 ? true : undefined), 'bridge start')
    expect((await runMaxSessionsCommand(supervisor, '1')).kind).toBe('success')
    expect(supervisor.bridgeIds()).toEqual(['cse_a'])
  }, 15000)

  test('registers the command when the commands service exists', async () => {
    const ctx = new FakeContext()
    const definitions: { name: string; handler: (invocation: { rawInput: string }) => unknown }[] = []
    ctx.provide('commands', {
      register: (definition: { name: string; handler: (invocation: { rawInput: string }) => unknown }) => {
        definitions.push(definition)
        return () => undefined
      },
    })

    registerCommands(ctx, { supervisor, config: envConfig(rcs.origin) })

    expect(definitions[0]?.name).toBe('rcs-max-sessions')
    const result = await definitions[0]?.handler({ rawInput: '3' })
    expect(result).toMatchObject({ kind: 'success' })
  })
})
