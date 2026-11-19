/**
 * Daemon worker entry point. The supervisor launches one child per worker kind
 * with `claude --daemon-worker <kind>`; each kind maps to a long-running task.
 * Today only `remoteControl` exists — it runs the headless bridge loop that
 * registers a bridge environment and accepts remote sessions.
 */

import { resolve } from 'node:path'

import { getBridgeAccessToken } from '../bridge/bridgeConfig.js'
import { BridgeHeadlessPermanentError, runBridgeHeadless, type HeadlessBridgeOpts } from '../bridge/bridgeMain.js'
import { handleOAuth401Error } from '../utils/auth.js'
import { errorMessage } from '../utils/errors.js'
import { EXIT_CODE_PERMANENT, EXIT_CODE_TRANSIENT } from './state.js'

/**
 * Runs the worker named by `kind` and exits with a code the supervisor uses to
 * decide retry vs park. Always exits explicitly: `runBridgeHeadless` returns
 * without calling `process.exit`, and sinks/GrowthBook can keep the event loop
 * alive after the bridge loop tears down.
 */
export async function runDaemonWorker(kind?: string): Promise<void> {
  let exitCode: number

  switch (kind) {
    case 'remoteControl':
      exitCode = await runRemoteControlWorker()
      break
    case undefined:
      console.error('Error: --daemon-worker requires a worker kind')
      exitCode = EXIT_CODE_PERMANENT
      break
    default:
      console.error(`Error: unknown daemon worker kind '${kind}'`)
      exitCode = EXIT_CODE_PERMANENT
  }

  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(exitCode)
}

/** Reads the supervisor-provided worker config from `DAEMON_WORKER_*` env vars. */
function readWorkerConfig(): HeadlessBridgeOpts {
  const timeoutRaw = process.env.DAEMON_WORKER_TIMEOUT_MS
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : Number.NaN
  const capacity = Number.parseInt(process.env.DAEMON_WORKER_CAPACITY || '4', 10)

  return {
    dir: process.env.DAEMON_WORKER_DIR || resolve('.'),
    name: process.env.DAEMON_WORKER_NAME || undefined,
    spawnMode: process.env.DAEMON_WORKER_SPAWN_MODE === 'worktree' ? 'worktree' : 'same-dir',
    capacity: Number.isNaN(capacity) ? 4 : capacity,
    permissionMode: process.env.DAEMON_WORKER_PERMISSION || undefined,
    sandbox: process.env.DAEMON_WORKER_SANDBOX === '1',
    sessionTimeoutMs: Number.isNaN(timeoutMs) ? undefined : timeoutMs,
    createSessionOnStart: process.env.DAEMON_WORKER_CREATE_SESSION !== '0',
    getAccessToken: getBridgeAccessToken,
    onAuth401: handleOAuth401Error,
    log: (message: string) => console.log(`[remoteControl] ${message}`),
  }
}

/**
 * Remote Control worker — runs the headless bridge loop until the supervisor
 * aborts it. Permanent config errors map to `EXIT_CODE_PERMANENT` so the
 * supervisor parks the worker instead of respawning it on backoff.
 */
async function runRemoteControlWorker(): Promise<number> {
  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  try {
    await runBridgeHeadless(readWorkerConfig(), controller.signal)
    return 0
  } catch (error) {
    if (error instanceof BridgeHeadlessPermanentError) {
      console.error(`[remoteControl] permanent error: ${error.message}`)
      return EXIT_CODE_PERMANENT
    }
    console.error(`[remoteControl] transient error: ${errorMessage(error)}`)
    return EXIT_CODE_TRANSIENT
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}
