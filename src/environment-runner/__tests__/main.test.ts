import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkSecret } from '../../bridge/types.js'
import { runEnvironmentRunner, type EnvironmentRunnerDeps } from '../main.js'

const tmp = mkdtempSync(join(tmpdir(), 'env-runner-main-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const DUMP_SCRIPT = join(tmp, 'dump.js')
writeFileSync(
  DUMP_SCRIPT,
  [
    "import { writeFileSync } from 'node:fs'",
    "const keys = ['CLAUDE_CODE_ENVIRONMENT_KIND','CLAUDE_CODE_REMOTE','CLAUDE_CODE_REMOTE_SESSION_ID','CLAUDE_CODE_SESSION_ACCESS_TOKEN','CLAUDE_CODE_USE_CCR_V2','CLAUDE_CODE_WORKER_EPOCH','MY_VAR']",
    'const out = {}',
    'for (const k of keys) out[k] = process.env[k]',
    'writeFileSync(process.env.DUMP_PATH, JSON.stringify(out))',
    "process.exit(Number(process.env.EXIT_CODE ?? '0'))",
  ].join('\n'),
)

function encodeSecret(secret: WorkSecret): string {
  return Buffer.from(JSON.stringify(secret)).toString('base64url')
}

function makeSecret(overrides: Partial<WorkSecret> = {}): WorkSecret {
  return {
    version: 1,
    session_ingress_token: 'tok-abc',
    api_base_url: 'https://api.example.com',
    sources: [],
    auth: [],
    ...overrides,
  } as WorkSecret
}

function makeDeps(partial: Partial<EnvironmentRunnerDeps> = {}): EnvironmentRunnerDeps {
  return {
    env: () => ({}),
    runnerVersion: '9.9.9',
    argvLaunch: () => ({ command: process.execPath, args: [DUMP_SCRIPT] }),
    registerWorker: async () => 0,
    bootstrapCredentials: () => {},
    executeSession,
    ...partial,
  }
}

// Re-export the real executor through main's default; tests inject the fake launch.
import { executeSession } from '../sessionExecutor.js'

describe('runEnvironmentRunner', () => {
  test('runs a v1 session with BYOC env markers and returns 0', async () => {
    const dumpPath = join(tmp, 'dump-v1.json')
    let launchedArgs: string[] = []
    const deps = makeDeps({
      env: () => ({ DUMP_PATH: dumpPath, EXIT_CODE: '0' }),
      argvLaunch: (childArgs) => {
        launchedArgs = childArgs
        return { command: process.execPath, args: [DUMP_SCRIPT] }
      },
    })
    const secret = makeSecret({ environment_variables: { MY_VAR: 'server-value' } })

    const code = await runEnvironmentRunner(['--work-secret', encodeSecret(secret), '--session-id', 'session_x'], deps)

    expect(code).toBe(0)
    expect(launchedArgs).toContain('--sdk-url')
    expect(launchedArgs).toContain('wss://api.example.com/v1/session_ingress/ws/session_x')
    expect(launchedArgs).toContain('--session-id')
  })

  test('registers a CCR v2 worker and passes its epoch to the child', async () => {
    const dumpPath = join(tmp, 'dump-v2.json')
    const registrations: Array<[string, string]> = []
    const deps = makeDeps({
      env: () => ({ DUMP_PATH: dumpPath, EXIT_CODE: '0' }),
      registerWorker: async (sdkUrl, token) => {
        registrations.push([sdkUrl, token])
        return 7
      },
    })
    const secret = makeSecret({ use_code_sessions: true })

    const code = await runEnvironmentRunner(['--work-secret', encodeSecret(secret), '--session-id', 'cse_abc'], deps)

    expect(code).toBe(0)
    expect(registrations).toEqual([['https://api.example.com/v1/code/sessions/cse_abc', 'tok-abc']])
  })

  test('returns 1 when the child reports failure', async () => {
    const dumpPath = join(tmp, 'dump-fail.json')
    const deps = makeDeps({ env: () => ({ DUMP_PATH: dumpPath, EXIT_CODE: '3' }) })
    const code = await runEnvironmentRunner(['--work-secret', encodeSecret(makeSecret()), '--session-id', 's'], deps)
    expect(code).toBe(1)
  })

  test('rejects when no work secret is provided', () => {
    const deps = makeDeps()
    return expect(runEnvironmentRunner([], deps)).rejects.toThrow(/work secret/i)
  })

  test('rejects when no session id is provided', () => {
    const deps = makeDeps()
    return expect(runEnvironmentRunner(['--work-secret', encodeSecret(makeSecret())], deps)).rejects.toThrow(
      /session id/i,
    )
  })

  test('bootstraps credentials before launching the child', async () => {
    const dumpPath = join(tmp, 'dump-boot.json')
    let bootstrapped = false
    const deps = makeDeps({
      env: () => ({ DUMP_PATH: dumpPath, EXIT_CODE: '0' }),
      bootstrapCredentials: () => {
        bootstrapped = true
      },
    })
    await runEnvironmentRunner(['--work-secret', encodeSecret(makeSecret()), '--session-id', 's'], deps)
    expect(bootstrapped).toBe(true)
  })
})
