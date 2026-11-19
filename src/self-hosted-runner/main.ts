/**
 * `claude self-hosted-runner` — a standalone, non-interactive Remote Control
 * worker for self-hosted deployments.
 *
 * It is the CLI-facing twin of the daemon's `remoteControl` worker: it wraps
 * `runBridgeHeadless`, which registers a bridge environment with the configured
 * bridge server and runs the work poll loop (poll doubles as the heartbeat).
 * Unlike the daemon, it takes its configuration from flags instead of
 * `DAEMON_WORKER_*` env vars and owns its own SIGTERM/SIGINT lifecycle.
 *
 * Self-hosted servers bypass the GrowthBook/policy entitlement gates (see
 * `isSelfHostedBridge`), so this entry does not gate on them; `runBridgeHeadless`
 * still enforces trust, auth presence, HTTPS, and worktree availability.
 */

import { getBridgeAccessToken } from '../bridge/bridgeConfig.js'
import { BridgeHeadlessPermanentError, runBridgeHeadless, type HeadlessBridgeOpts } from '../bridge/bridgeMain.js'
import { BRIDGE_LOGIN_ERROR } from '../bridge/types.js'
import { handleOAuth401Error } from '../utils/auth.js'
import { errorMessage } from '../utils/errors.js'

export type SelfHostedSpawnMode = 'same-dir' | 'worktree'

export interface SelfHostedRunnerArgs {
  dir?: string
  name?: string
  spawnMode: SelfHostedSpawnMode
  capacity: number
  permissionMode?: string
  sandbox: boolean
  sessionTimeoutMs?: number
  createSessionOnStart: boolean
  help: boolean
  /** Set when parsing failed; callers should print it and exit non-zero. */
  error?: string
}

const DEFAULT_CAPACITY = 4

/**
 * Parse `claude self-hosted-runner` flags. Accepts both `--flag value` and
 * `--flag=value` forms. Unknown arguments and invalid values surface as
 * `error` rather than throwing.
 */
export function parseSelfHostedRunnerArgs(args: string[]): SelfHostedRunnerArgs {
  const parsed: SelfHostedRunnerArgs = {
    spawnMode: 'same-dir',
    capacity: DEFAULT_CAPACITY,
    sandbox: false,
    createSessionOnStart: true,
    help: false,
  }
  const fail = (error: string): SelfHostedRunnerArgs => ({ ...parsed, error })

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (arg === '--sandbox') {
      parsed.sandbox = true
      continue
    }
    if (arg === '--no-sandbox') {
      parsed.sandbox = false
      continue
    }
    if (arg === '--create-session') {
      parsed.createSessionOnStart = true
      continue
    }
    if (arg === '--no-create-session') {
      parsed.createSessionOnStart = false
      continue
    }

    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1)
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue
      const next = args[i + 1]
      if (next !== undefined) {
        i++
        return next
      }
      return undefined
    }

    switch (name) {
      case '--dir': {
        const value = takeValue()
        if (value === undefined) return fail('--dir requires a value')
        parsed.dir = value
        break
      }
      case '--name': {
        const value = takeValue()
        if (value === undefined) return fail('--name requires a value')
        parsed.name = value
        break
      }
      case '--permission-mode': {
        const value = takeValue()
        if (value === undefined) return fail('--permission-mode requires a value')
        parsed.permissionMode = value
        break
      }
      case '--spawn': {
        const value = takeValue()
        if (value !== 'same-dir' && value !== 'worktree') {
          return fail(`--spawn requires one of: same-dir, worktree (got: ${value ?? '<missing>'})`)
        }
        parsed.spawnMode = value
        break
      }
      case '--capacity': {
        const value = takeValue()
        const n = value === undefined ? Number.NaN : Number.parseInt(value, 10)
        if (!Number.isInteger(n) || n < 1) {
          return fail(`--capacity requires a positive integer (got: ${value ?? '<missing>'})`)
        }
        parsed.capacity = n
        break
      }
      case '--session-timeout': {
        const value = takeValue()
        const seconds = value === undefined ? Number.NaN : Number.parseInt(value, 10)
        if (!Number.isInteger(seconds) || seconds < 1) {
          return fail(`--session-timeout requires a positive integer number of seconds (got: ${value ?? '<missing>'})`)
        }
        parsed.sessionTimeoutMs = seconds * 1000
        break
      }
      default:
        return fail(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

export interface SignalHandle {
  signal: AbortSignal
  dispose: () => void
}

export interface SelfHostedRunnerOverrides {
  runHeadless?: (opts: HeadlessBridgeOpts, signal: AbortSignal) => Promise<void>
  getAccessToken?: () => string | undefined
  onAuth401?: (failedToken: string) => Promise<boolean>
  installSignals?: () => SignalHandle
  log?: (line: string) => void
  cwd?: () => string
}

/** Abort on SIGTERM/SIGINT; `dispose` unregisters the listeners. */
function installDefaultSignals(): SignalHandle {
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
    },
  }
}

/**
 * Run the self-hosted worker and return the process exit code (0 clean
 * shutdown, 1 on any error). Exposed separately from `selfHostedRunnerMain` so
 * it can be driven without `process.exit` from tests.
 */
export async function runSelfHostedRunner(args: string[], overrides: SelfHostedRunnerOverrides = {}): Promise<number> {
  const runHeadless = overrides.runHeadless ?? runBridgeHeadless
  const getAccessToken = overrides.getAccessToken ?? getBridgeAccessToken
  const onAuth401 = overrides.onAuth401 ?? handleOAuth401Error
  const installSignals = overrides.installSignals ?? installDefaultSignals
  const log = overrides.log ?? ((line: string) => process.stderr.write(`[self-hosted-runner] ${line}\n`))
  const cwd = overrides.cwd ?? (() => process.cwd())

  const parsed = parseSelfHostedRunnerArgs(args)
  if (parsed.help) {
    printUsage()
    return 0
  }
  if (parsed.error) {
    log(parsed.error)
    return 1
  }

  if (!getAccessToken()) {
    log(BRIDGE_LOGIN_ERROR)
    return 1
  }

  const { signal, dispose } = installSignals()
  const opts: HeadlessBridgeOpts = {
    dir: parsed.dir ?? cwd(),
    name: parsed.name,
    spawnMode: parsed.spawnMode,
    capacity: parsed.capacity,
    permissionMode: parsed.permissionMode,
    sandbox: parsed.sandbox,
    sessionTimeoutMs: parsed.sessionTimeoutMs,
    createSessionOnStart: parsed.createSessionOnStart,
    getAccessToken,
    onAuth401,
    log,
  }

  try {
    await runHeadless(opts, signal)
    return 0
  } catch (error) {
    if (error instanceof BridgeHeadlessPermanentError) {
      log(`permanent error: ${error.message}`)
    } else {
      log(`error: ${errorMessage(error)}`)
    }
    return 1
  } finally {
    dispose()
  }
}

/** CLI entry point: run, then exit explicitly (sinks can outlive a clean abort). */
export async function selfHostedRunnerMain(args: string[]): Promise<void> {
  try {
    const code = await runSelfHostedRunner(args)
    process.exit(code)
  } catch (error) {
    console.error(`self-hosted-runner: ${errorMessage(error)}`)
    process.exit(1)
  }
}

function printUsage(): void {
  console.log(
    [
      'Usage: claude self-hosted-runner [options]',
      '',
      'Standalone headless Remote Control worker for self-hosted deployments:',
      'registers a bridge environment with the configured bridge server and polls',
      'for work (poll doubles as the heartbeat).',
      '',
      'Options:',
      '  --dir <path>               Working directory (default: cwd)',
      '  --name <name>              Display name for pre-created sessions',
      '  --spawn <mode>             same-dir | worktree (default: same-dir)',
      `  --capacity <N>             Max concurrent sessions (default: ${DEFAULT_CAPACITY})`,
      '  --permission-mode <mode>   Permission mode for spawned sessions',
      '  --sandbox                  Run sessions in the sandbox',
      '  --session-timeout <secs>   Per-session timeout',
      '  --[no-]create-session      Pre-create a session on start (default: on)',
      '  -h, --help                 Show this help',
    ].join('\n'),
  )
}
