import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RcsClient } from '@sobird/dsh-bridge/core'
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

  // 单会话模式也注册命令，但执行时只回提示，避免用户以为命令静默失效。
  test('single mode registers the commands with an environment-only hint', async () => {
    const ctx = new FakeContext()
    const definitions: {
      name: string
      handler: (invocation: { rawInput: string; agent?: { id: string } }) => unknown
    }[] = []
    ctx.provide('commands', {
      register: (definition: (typeof definitions)[number]) => {
        definitions.push(definition)
        return () => undefined
      },
    })

    registerCommands(ctx, {
      supervisor: null,
      config: { ...envConfig(rcs.origin), mode: 'single' },
      rcs: new RcsClient({ baseUrl: rcs.origin, apiKey: 'test-key' }),
    })

    expect(definitions.map((definition) => definition.name)).toEqual(['rcs-max-sessions', 'rcs-sync'])
    for (const definition of definitions) {
      const result = await definition.handler({ rawInput: '', agent: { id: 'session-local' } })
      expect(result).toMatchObject({ kind: 'error' })
      expect(result).toHaveProperty('text', expect.stringContaining('环境模式'))
    }
  })

  test('registers the command when the commands service exists', async () => {
    const ctx = new FakeContext()
    const definitions: {
      name: string
      input?: { hint: string }
      handler: (invocation: { rawInput: string }) => unknown
    }[] = []
    ctx.provide('commands', {
      register: (definition: (typeof definitions)[number]) => {
        definitions.push(definition)
        return () => undefined
      },
    })

    registerCommands(ctx, {
      supervisor,
      config: envConfig(rcs.origin),
      rcs: new RcsClient({ baseUrl: rcs.origin, apiKey: 'test-key' }),
    })

    expect(definitions[0]?.name).toBe('rcs-max-sessions')
    // 无 input 描述符时，Web 端「带参数的一行」会被判为普通消息丢给模型（命令不执行）。
    expect(definitions[0]?.input).toEqual({ hint: '<正整数>' })
    const result = await definitions[0]?.handler({ rawInput: '3' })
    expect(result).toMatchObject({ kind: 'success' })
  })
})
