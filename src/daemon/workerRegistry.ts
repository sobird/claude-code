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
    const gateError = await checkBridgeEntitlements()
    if (gateError !== null) {
      throw new BridgeHeadlessPermanentError(gateError)
    }
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

/**
 * Entitlement gates the interactive bridge enforces (the `remote-control` fast
 * path in entrypoints/cli.tsx and the /remote-control command): GrowthBook
 * availability, minimum version, and the org policy toggle. Checked by the
 * worker rather than runBridgeHeadless so the upstream bridge source stays
 * unmodified. Returns null when allowed, else a message the caller maps to a
 * permanent (park) failure.
 *
 * Skips the gates without a bridge token: runBridgeHeadless then throws its
 * transient BRIDGE_LOGIN_ERROR so the supervisor keeps retrying after login.
 */
async function checkBridgeEntitlements(): Promise<string | null> {
  // GrowthBook and policy limits read the global config; the --daemon-worker
  // fast path skips init.ts. runBridgeHeadless re-enables configs (idempotent).
  const { enableConfigs } = await import('../utils/config.js')
  enableConfigs()

  if (!getBridgeAccessToken()) return null

  // getBridgeDisabledReason short-circuits to null for self-hosted servers,
  // so a custom bridge skips GrowthBook.
  const { getBridgeDisabledReason, checkBridgeMinVersion } = await import('../bridge/bridgeEnabled.js')
  const disabledReason = await getBridgeDisabledReason()
  if (disabledReason) return disabledReason

  const versionError = checkBridgeMinVersion()
  if (versionError) return versionError

  const { initializePolicyLimitsLoadingPromise, loadPolicyLimits, waitForPolicyLimitsToLoad, isPolicyAllowed } =
    await import('../services/policyLimits/index.js')
  // Initialize first so the promise carries its 30s timeout guard;
  // loadPolicyLimits() reuses it and resolves it when the fetch lands.
  initializePolicyLimitsLoadingPromise()
  void loadPolicyLimits().catch((error: unknown) => {
    console.error(`[remoteControl] policy limits load failed: ${errorMessage(error)}`)
  })
  await waitForPolicyLimitsToLoad()
  if (!isPolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy."
  }

  return null
}
