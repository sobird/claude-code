import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RcsClient } from '@sobird/dsh-bridge/core'
import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { registerCommands, runLoginCommand, runLogoutCommand, runMaxSessionsCommand } from '../src/commands'
import type { ResolvedConfig } from '../src/config'
import { readCredentials, writeCredentials } from '../src/credentials'
import { startSupervisor, type SessionSupervisor } from '../src/supervisor'
import { FakeContext } from './helpers/fake-ctx'

const GRANT = {
  deviceCode: 'device-code',
  userCode: 'ABCD-2345',
  verificationUri: 'https://rcs.example.com/device',
  verificationUriComplete: 'https://rcs.example.com/device#code=ABCD-2345',
  expiresIn: 600,
  interval: 5,
}

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

    expect(definitions.map((definition) => definition.name)).toEqual([
      'rcs-max-sessions',
      'rcs-sync',
      'rcs-login',
      'rcs-logout',
    ])
    // 只有环境管理类命令受模式限制；login/logout 在任何模式下都可用。
    for (const definition of definitions.slice(0, 2)) {
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

describe('rcs-login / rcs-logout', () => {
  // Web UI 只显示命令返回值，配对码必须立即回给用户；批准后的落盘在后台完成。
  test('login hands the code back immediately without waiting for approval', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'rcs-login-'))
    let polls = 0
    const result = await runLoginCommand({
      config: envConfig('https://rcs.example.com'),
      stateDir,
      openUrl: () => {},
      deviceClient: {
        async requestCode() {
          return GRANT
        },
        pollToken() {
          polls += 1
          // 永不 resolve：模拟用户还没批准，命令也必须先返回。
          return new Promise<never>(() => {})
        },
      },
    })

    expect(result.kind).toBe('success')
    expect(result.text).toContain('ABCD-2345')
    // 远程场景下用户只能从命令结果拿到链接，所以 complete 链接也要回给用户。
    expect(result.text).toContain('https://rcs.example.com/device#code=ABCD-2345')
    expect(await readCredentials(stateDir)).toBeNull()
    expect(polls).toBeGreaterThanOrEqual(1)
  })

  test('login keeps polling in the background and writes the credential file', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'rcs-login-'))
    const result = await runLoginCommand({
      config: envConfig('https://rcs.example.com'),
      stateDir,
      openUrl: () => {},
      deviceClient: {
        async requestCode() {
          return GRANT
        },
        async pollToken() {
          return { status: 'approved', apiKey: 'rcs_login' }
        },
      },
    })
    expect(result.kind).toBe('success')

    let saved = await readCredentials(stateDir)
    const deadline = Date.now() + 2000
    while (!saved && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      saved = await readCredentials(stateDir)
    }
    expect(saved?.apiKey).toBe('rcs_login')
  })

  test('login surfaces failures as an error result', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'rcs-login-'))
    const result = await runLoginCommand({
      config: envConfig('https://rcs.example.com'),
      stateDir,
      openUrl: () => {},
      deviceClient: {
        async requestCode() {
          throw new Error('offline')
        },
        async pollToken() {
          throw new Error('offline')
        },
      },
    })

    expect(result.kind).toBe('error')
    expect(result.text).toContain('offline')
  })

  test('logout clears the file and is idempotent', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'rcs-logout-'))
    await writeCredentials(stateDir, {
      version: 1,
      rcsBaseUrl: 'https://rcs.example.com',
      apiKey: 'rcs_saved',
      createdAt: '2026-11-24T00:00:00.000Z',
    })

    expect((await runLogoutCommand(stateDir)).kind).toBe('success')
    expect(await readCredentials(stateDir)).toBeNull()
    expect((await runLogoutCommand(stateDir)).kind).toBe('success')
  })
})
