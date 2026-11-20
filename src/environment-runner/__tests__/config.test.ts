import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkSecret } from '../../bridge/types.js'
import {
  buildChildArgs,
  buildChildEnv,
  expandClaudeCodeArgs,
  parseRunnerArgs,
  prepareTransport,
  readWorkSecretString,
  resolveSessionId,
} from '../config.js'

function makeSecret(overrides: Partial<WorkSecret> = {}): WorkSecret {
  return {
    version: 1,
    session_ingress_token: 'tok-123',
    api_base_url: 'https://api.example.com',
    sources: [],
    auth: [],
    ...overrides,
  } as WorkSecret
}

const tmp = mkdtempSync(join(tmpdir(), 'env-runner-config-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('parseRunnerArgs', () => {
  test('parses every supported flag', () => {
    const parsed = parseRunnerArgs([
      '--work-secret',
      'abc',
      '--work-secret-file',
      '/tmp/secret',
      '--session-id',
      'session_x',
      '--api-base-url',
      'https://x.test',
      '--sdk-url',
      'wss://x.test/ws',
      '--cwd',
      '/work',
      '--permission-mode',
      'plan',
      '--dangerously-skip-permissions',
      '--debug-file',
      '/tmp/dbg.log',
      '--verbose',
    ])
    expect(parsed).toMatchObject({
      workSecret: 'abc',
      workSecretFile: '/tmp/secret',
      sessionId: 'session_x',
      apiBaseUrl: 'https://x.test',
      sdkUrl: 'wss://x.test/ws',
      cwd: '/work',
      permissionMode: 'plan',
      dangerouslySkipPermissions: true,
      debugFile: '/tmp/dbg.log',
      verbose: true,
      help: false,
    })
  })

  test('defaults booleans to false', () => {
    const parsed = parseRunnerArgs([])
    expect(parsed.dangerouslySkipPermissions).toBe(false)
    expect(parsed.verbose).toBe(false)
    expect(parsed.help).toBe(false)
  })

  test('recognizes --help and -h', () => {
    expect(parseRunnerArgs(['--help']).help).toBe(true)
    expect(parseRunnerArgs(['-h']).help).toBe(true)
  })
})

describe('readWorkSecretString', () => {
  test('an explicit --work-secret wins over everything else', () => {
    const parsed = parseRunnerArgs(['--work-secret', 'from-flag'])
    const value = readWorkSecretString(parsed, { CLAUDE_CODE_WORK_SECRET: 'from-env' })
    expect(value).toBe('from-flag')
  })

  test('reads and trims a --work-secret-file', () => {
    const file = join(tmp, 'secret.txt')
    writeFileSync(file, '  from-file\n')
    const parsed = parseRunnerArgs(['--work-secret-file', file])
    expect(readWorkSecretString(parsed, {})).toBe('from-file')
  })

  test('falls back to the environment', () => {
    const parsed = parseRunnerArgs([])
    expect(readWorkSecretString(parsed, { CLAUDE_CODE_WORK_SECRET: 'from-env' })).toBe('from-env')
  })

  test('returns null when nothing is provided', () => {
    expect(readWorkSecretString(parseRunnerArgs([]), {})).toBeNull()
  })
})

describe('resolveSessionId', () => {
  test('--session-id wins over the environment', () => {
    const parsed = parseRunnerArgs(['--session-id', 'session_flag'])
    expect(resolveSessionId(parsed, { CLAUDE_CODE_REMOTE_SESSION_ID: 'session_env' })).toBe('session_flag')
  })

  test('falls back to CLAUDE_CODE_REMOTE_SESSION_ID', () => {
    expect(resolveSessionId(parseRunnerArgs([]), { CLAUDE_CODE_REMOTE_SESSION_ID: 'session_env' })).toBe('session_env')
  })

  test('returns null when missing', () => {
    expect(resolveSessionId(parseRunnerArgs([]), {})).toBeNull()
  })
})

describe('expandClaudeCodeArgs', () => {
  test('expands values, boolean-true, and already-prefixed keys', () => {
    const args = expandClaudeCodeArgs({ model: 'opus', verbose: 'true', '--foo': 'bar', off: 'false' })
    expect(args).toEqual(['--model', 'opus', '--verbose', '--foo', 'bar'])
  })

  test('returns an empty list for null/undefined', () => {
    expect(expandClaudeCodeArgs(undefined)).toEqual([])
    expect(expandClaudeCodeArgs(null)).toEqual([])
  })
})

describe('buildChildArgs', () => {
  test('produces the SDK stream-json invocation with server-driven extras', () => {
    const args = buildChildArgs({
      secret: makeSecret({
        claude_code_args: { model: 'opus' },
        mcp_config: { mcpServers: {} },
      }),
      sdkUrl: 'wss://api.example.com/v1/session_ingress/ws/session_x',
      sessionId: 'session_x',
      permissionMode: 'acceptEdits',
      dangerouslySkipPermissions: false,
      debugFile: '/tmp/dbg.log',
      verbose: true,
    })
    expect(args).toEqual([
      '--print',
      '--sdk-url',
      'wss://api.example.com/v1/session_ingress/ws/session_x',
      '--session-id',
      'session_x',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--replay-user-messages',
      '--verbose',
      '--debug-file',
      '/tmp/dbg.log',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'opus',
      '--mcp-config',
      '{"mcpServers":{}}',
    ])
  })

  test('dangerously-skip-permissions supersedes --permission-mode', () => {
    const args = buildChildArgs({
      secret: makeSecret(),
      sdkUrl: 'wss://x/ws',
      sessionId: 's',
      permissionMode: 'plan',
      dangerouslySkipPermissions: true,
      verbose: false,
    })
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--permission-mode')
    expect(args).not.toContain('--verbose')
    expect(args).not.toContain('--debug-file')
  })
})

describe('buildChildEnv', () => {
  test('stamps BYOC markers and applies server environment_variables', () => {
    const env = buildChildEnv({
      baseEnv: { PATH: '/usr/bin', MY_VAR: 'base' },
      secret: makeSecret({ environment_variables: { MY_VAR: 'overridden', EXTRA: '1' } }),
      sessionId: 'session_x',
      runnerVersion: '2.1.90',
      useCcrV2: false,
    })
    expect(env.CLAUDE_CODE_ENVIRONMENT_KIND).toBe('byoc')
    expect(env.CLAUDE_CODE_REMOTE).toBe('1')
    expect(env.CLAUDE_CODE_REMOTE_SESSION_ID).toBe('session_x')
    expect(env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('tok-123')
    expect(env.CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION).toBe('2.1.90')
    expect(env.CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2).toBe('1')
    expect(env.MY_VAR).toBe('overridden')
    expect(env.EXTRA).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.CLAUDE_CODE_USE_CCR_V2).toBeUndefined()
    expect(env.CLAUDE_CODE_WORKER_EPOCH).toBeUndefined()
  })

  test('adds the CCR v2 worker epoch when v2 is active', () => {
    const env = buildChildEnv({
      baseEnv: {},
      secret: makeSecret(),
      sessionId: 'session_x',
      runnerVersion: '2.1.90',
      useCcrV2: true,
      workerEpoch: 42,
    })
    expect(env.CLAUDE_CODE_USE_CCR_V2).toBe('1')
    expect(env.CLAUDE_CODE_WORKER_EPOCH).toBe('42')
  })

  test('drops undefined base values instead of emitting them', () => {
    const env = buildChildEnv({
      baseEnv: { KEEP: 'yes', DROP: undefined },
      secret: makeSecret(),
      sessionId: 's',
      runnerVersion: 'v',
      useCcrV2: false,
    })
    expect(env.KEEP).toBe('yes')
    expect('DROP' in env).toBe(false)
  })
})

describe('prepareTransport', () => {
  test('v1 builds a session-ingress WebSocket URL', async () => {
    const result = await prepareTransport(
      { secret: makeSecret(), sessionId: 'session_x', apiBaseUrl: 'https://api.example.com' },
      { registerWorker: async () => 1 },
    )
    expect(result).toEqual({
      sdkUrl: 'wss://api.example.com/v1/session_ingress/ws/session_x',
      useCcrV2: false,
    })
  })

  test('use_code_sessions registers a CCR v2 worker and returns the epoch', async () => {
    const calls: Array<[string, string]> = []
    const result = await prepareTransport(
      {
        secret: makeSecret({ use_code_sessions: true }),
        sessionId: 'cse_abc',
        apiBaseUrl: 'https://api.example.com',
      },
      {
        registerWorker: async (sdkUrl, token) => {
          calls.push([sdkUrl, token])
          return 7
        },
      },
    )
    expect(result).toEqual({
      sdkUrl: 'https://api.example.com/v1/code/sessions/cse_abc',
      useCcrV2: true,
      workerEpoch: 7,
    })
    expect(calls).toEqual([['https://api.example.com/v1/code/sessions/cse_abc', 'tok-123']])
  })

  test('an explicit --sdk-url bypasses transport selection and worker registration', async () => {
    let called = false
    const result = await prepareTransport(
      {
        secret: makeSecret({ use_code_sessions: true }),
        sessionId: 'cse_abc',
        apiBaseUrl: 'https://api.example.com',
        sdkUrlOverride: 'wss://override/ws',
      },
      {
        registerWorker: async () => {
          called = true
          return 1
        },
      },
    )
    expect(result).toEqual({ sdkUrl: 'wss://override/ws', useCcrV2: false })
    expect(called).toBe(false)
  })
})
