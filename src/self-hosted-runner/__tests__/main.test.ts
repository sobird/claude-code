import { describe, expect, test } from 'bun:test'

import { BridgeHeadlessPermanentError, type HeadlessBridgeOpts } from '../../bridge/bridgeMain.js'
import { parseSelfHostedRunnerArgs, runSelfHostedRunner, type SelfHostedRunnerOverrides } from '../main.js'

describe('parseSelfHostedRunnerArgs', () => {
  test('applies defaults when no flags are given', () => {
    const parsed = parseSelfHostedRunnerArgs([])
    expect(parsed.error).toBeUndefined()
    expect(parsed.help).toBe(false)
    expect(parsed.spawnMode).toBe('same-dir')
    expect(parsed.capacity).toBe(4)
    expect(parsed.sandbox).toBe(false)
    expect(parsed.createSessionOnStart).toBe(true)
    expect(parsed.dir).toBeUndefined()
    expect(parsed.name).toBeUndefined()
    expect(parsed.permissionMode).toBeUndefined()
    expect(parsed.sessionTimeoutMs).toBeUndefined()
  })

  test('parses every flag in space-separated form', () => {
    const parsed = parseSelfHostedRunnerArgs([
      '--dir',
      '/work',
      '--name',
      'worker-1',
      '--spawn',
      'worktree',
      '--capacity',
      '2',
      '--permission-mode',
      'plan',
      '--sandbox',
      '--session-timeout',
      '60',
      '--no-create-session',
    ])
    expect(parsed.error).toBeUndefined()
    expect(parsed.dir).toBe('/work')
    expect(parsed.name).toBe('worker-1')
    expect(parsed.spawnMode).toBe('worktree')
    expect(parsed.capacity).toBe(2)
    expect(parsed.permissionMode).toBe('plan')
    expect(parsed.sandbox).toBe(true)
    expect(parsed.sessionTimeoutMs).toBe(60_000)
    expect(parsed.createSessionOnStart).toBe(false)
  })

  test('parses flags in --key=value form', () => {
    const parsed = parseSelfHostedRunnerArgs([
      '--dir=/srv',
      '--spawn=worktree',
      '--capacity=3',
      '--permission-mode=default',
      '--session-timeout=120',
    ])
    expect(parsed.error).toBeUndefined()
    expect(parsed.dir).toBe('/srv')
    expect(parsed.spawnMode).toBe('worktree')
    expect(parsed.capacity).toBe(3)
    expect(parsed.permissionMode).toBe('default')
    expect(parsed.sessionTimeoutMs).toBe(120_000)
  })

  test('recognizes --help and -h', () => {
    expect(parseSelfHostedRunnerArgs(['--help']).help).toBe(true)
    expect(parseSelfHostedRunnerArgs(['-h']).help).toBe(true)
  })

  test('--no-sandbox and --create-session toggle the booleans', () => {
    const parsed = parseSelfHostedRunnerArgs(['--sandbox', '--no-sandbox', '--no-create-session', '--create-session'])
    expect(parsed.sandbox).toBe(false)
    expect(parsed.createSessionOnStart).toBe(true)
  })

  test('rejects an unsupported --spawn value', () => {
    const parsed = parseSelfHostedRunnerArgs(['--spawn', 'session'])
    expect(parsed.error).toMatch(/same-dir, worktree/)
  })

  test('rejects an invalid --capacity', () => {
    expect(parseSelfHostedRunnerArgs(['--capacity', '0']).error).toMatch(/capacity/i)
    expect(parseSelfHostedRunnerArgs(['--capacity', 'abc']).error).toMatch(/capacity/i)
  })

  test('rejects an invalid --session-timeout', () => {
    expect(parseSelfHostedRunnerArgs(['--session-timeout', '0']).error).toMatch(/timeout/i)
    expect(parseSelfHostedRunnerArgs(['--session-timeout', 'x']).error).toMatch(/timeout/i)
  })

  test('rejects unknown arguments', () => {
    expect(parseSelfHostedRunnerArgs(['--bogus']).error).toMatch(/unknown argument/i)
  })
})

function makeOverrides(partial: Partial<SelfHostedRunnerOverrides> = {}): SelfHostedRunnerOverrides {
  return {
    getAccessToken: () => 'tok-abc',
    onAuth401: async () => false,
    installSignals: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    log: () => {},
    cwd: () => '/cwd',
    runHeadless: async () => {},
    ...partial,
  }
}

describe('runSelfHostedRunner', () => {
  test('returns 0 on --help without launching the worker', async () => {
    let launched = false
    const code = await runSelfHostedRunner(
      ['--help'],
      makeOverrides({
        runHeadless: async () => {
          launched = true
        },
      }),
    )
    expect(code).toBe(0)
    expect(launched).toBe(false)
  })

  test('builds HeadlessBridgeOpts from flags and returns 0 on clean shutdown', async () => {
    let captured: HeadlessBridgeOpts | undefined
    let disposed = false
    const code = await runSelfHostedRunner(
      [
        '--dir',
        '/work',
        '--name',
        'w1',
        '--spawn',
        'worktree',
        '--capacity',
        '2',
        '--permission-mode',
        'plan',
        '--sandbox',
        '--session-timeout',
        '30',
        '--no-create-session',
      ],
      makeOverrides({
        runHeadless: async (opts) => {
          captured = opts
        },
        installSignals: () => ({ signal: new AbortController().signal, dispose: () => (disposed = true) }),
      }),
    )

    expect(code).toBe(0)
    expect(disposed).toBe(true)
    expect(captured).toBeDefined()
    expect(captured!.dir).toBe('/work')
    expect(captured!.name).toBe('w1')
    expect(captured!.spawnMode).toBe('worktree')
    expect(captured!.capacity).toBe(2)
    expect(captured!.permissionMode).toBe('plan')
    expect(captured!.sandbox).toBe(true)
    expect(captured!.sessionTimeoutMs).toBe(30_000)
    expect(captured!.createSessionOnStart).toBe(false)
    expect(typeof captured!.getAccessToken).toBe('function')
    expect(typeof captured!.onAuth401).toBe('function')
    expect(typeof captured!.log).toBe('function')
  })

  test('defaults the working directory to the injected cwd', async () => {
    let captured: HeadlessBridgeOpts | undefined
    await runSelfHostedRunner(
      [],
      makeOverrides({
        cwd: () => '/here',
        runHeadless: async (opts) => {
          captured = opts
        },
      }),
    )
    expect(captured!.dir).toBe('/here')
  })

  test('returns 1 and refuses to launch when not logged in', async () => {
    let launched = false
    const logs: string[] = []
    const code = await runSelfHostedRunner(
      [],
      makeOverrides({
        getAccessToken: () => undefined,
        log: (line) => logs.push(line),
        runHeadless: async () => {
          launched = true
        },
      }),
    )
    expect(code).toBe(1)
    expect(launched).toBe(false)
    expect(logs.join('\n')).toMatch(/logged in/i)
  })

  test('returns 1 on a parse error without launching', async () => {
    let launched = false
    const logs: string[] = []
    const code = await runSelfHostedRunner(
      ['--bogus'],
      makeOverrides({
        log: (line) => logs.push(line),
        runHeadless: async () => {
          launched = true
        },
      }),
    )
    expect(code).toBe(1)
    expect(launched).toBe(false)
    expect(logs.join('\n')).toMatch(/unknown argument/i)
  })

  test('maps a permanent bridge error to exit code 1 and tags the log', async () => {
    let disposed = false
    const logs: string[] = []
    const code = await runSelfHostedRunner(
      [],
      makeOverrides({
        log: (line) => logs.push(line),
        installSignals: () => ({ signal: new AbortController().signal, dispose: () => (disposed = true) }),
        runHeadless: async () => {
          throw new BridgeHeadlessPermanentError('workspace not trusted')
        },
      }),
    )
    expect(code).toBe(1)
    expect(disposed).toBe(true)
    expect(logs.join('\n')).toMatch(/permanent/i)
    expect(logs.join('\n')).toMatch(/workspace not trusted/)
  })

  test('maps a transient error to exit code 1', async () => {
    const logs: string[] = []
    const code = await runSelfHostedRunner(
      [],
      makeOverrides({
        log: (line) => logs.push(line),
        runHeadless: async () => {
          throw new Error('connection refused')
        },
      }),
    )
    expect(code).toBe(1)
    expect(logs.join('\n')).toMatch(/connection refused/)
  })
})
