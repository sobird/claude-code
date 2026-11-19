/**
 * Daemon supervisor entry point, reached from `claude daemon [subcommand]`
 * (`entrypoints/cli.tsx`). The supervisor owns long-running worker children and
 * restarts them on crash with exponential backoff.
 *
 * Started detached by the assistant install wizard (`commands/assistant`); a
 * foreground `claude daemon start` behaves the same, just without the TUI.
 */

import { type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

import { buildCliLaunch, spawnCli } from '../utils/cliLaunch.js'
import { errorMessage } from '../utils/errors.js'
import {
  assertValidDaemonName,
  EXIT_CODE_PERMANENT,
  queryDaemonStatus,
  readDaemonState,
  removeDaemonState,
  stopDaemonByPid,
  writeDaemonState,
} from './state.js'

const BACKOFF_INITIAL_MS = 2_000
const BACKOFF_CAP_MS = 120_000
const BACKOFF_MULTIPLIER = 2
const MAX_RAPID_FAILURES = 5
/** A worker that dies within this window counts as a rapid failure. */
const RAPID_FAILURE_WINDOW_MS = 10_000
/** How long to wait for a worker to exit before SIGKILL on shutdown. */
const KILL_GRACE_MS = 30_000

interface WorkerState {
  kind: string
  process: ChildProcess | null
  backoffMs: number
  failureCount: number
  parked: boolean
  lastStartTime: number
  restartTimer: ReturnType<typeof setTimeout> | null
}

interface SupervisorConfig {
  dir?: string
  name?: string
  spawnMode?: string
  capacity?: string
  permissionMode?: string
  sandbox?: string
}

/**
 * `claude daemon [subcommand]` dispatcher.
 *
 * Subcommands: `start` (run the supervisor), `stop`, `status`/`ps` (default),
 * and `help`. Background-session subcommands (`bg`/`attach`/`logs`/`kill`) are
 * intentionally absent — they belong to `BG_SESSIONS`, which is not enabled.
 */
export async function daemonMain(args: string[]): Promise<void> {
  const subcommand = args[0] || 'status'
  const rest = args.slice(1)

  let stateName: string | undefined
  try {
    stateName = parseStateName(rest)
  } catch (error) {
    console.error(errorMessage(error))
    process.exitCode = 1
    return
  }

  switch (subcommand) {
    case 'start':
      await runSupervisor(rest, stateName)
      break
    case 'stop':
      await handleDaemonStop(stateName)
      break
    case 'status':
    case 'ps':
      await showStatus(stateName)
      break
    case '--help':
    case '-h':
    case 'help':
      printHelp()
      break
    default:
      console.error(`Unknown daemon subcommand: ${subcommand}`)
      printHelp()
      process.exitCode = 1
  }
}

/** `--name` selects the state file, so must be valid for every subcommand. */
function parseStateName(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--name' && i + 1 < args.length) {
      return assertValidDaemonName(args[++i])
    }
    if (arg.startsWith('--name=')) {
      return assertValidDaemonName(arg.slice('--name='.length))
    }
  }
  return undefined
}

function printHelp(): void {
  console.log(`
Claude Code daemon — background supervisor management

USAGE
  claude daemon [subcommand]

SUBCOMMANDS
  status      Show supervisor status (default)
  start       Start the supervisor (foreground)
  stop        Stop a running supervisor
  help        Show this help

OPTIONS (for start)
  --dir <path>              Working directory (default: current)
  --name <name>             Session name; also selects the daemon state file
                            (default: remote-control). Manage it later with
                            status/stop --name <name>.
  --spawn-mode <mode>       Worker spawn mode: same-dir | worktree (default: same-dir)
  --capacity <N>            Max concurrent sessions per worker (default: 4)
  --permission-mode <mode>  Permission mode for spawned sessions
  --sandbox                 Enable sandbox mode
`)
}

async function showStatus(stateName?: string): Promise<void> {
  const result = await queryDaemonStatus(stateName)
  switch (result.status) {
    case 'running': {
      const state = result.state
      if (!state) return
      console.log('Daemon supervisor: running')
      console.log(`  PID:     ${state.pid}`)
      console.log(`  CWD:     ${state.cwd}`)
      console.log(`  Started: ${state.startedAt}`)
      const parked = state.parkedWorkers ?? []
      const workers = state.workerKinds.map((kind) => (parked.includes(kind) ? `${kind} (parked)` : kind))
      console.log(`  Workers: ${workers.join(', ')}`)
      return
    }
    case 'stopped':
      console.log('Daemon supervisor: stopped')
      return
    case 'stale':
      console.log('Daemon supervisor: stale (cleaned up)')
  }
}

async function handleDaemonStop(stateName?: string): Promise<void> {
  const result = await queryDaemonStatus(stateName)
  if (result.status === 'stopped') {
    console.log('daemon is not running')
    return
  }
  if (result.status === 'stale') {
    console.log('daemon was stale (cleaned up)')
    return
  }

  const pid = result.state?.pid
  console.log(`stopping daemon${pid === undefined ? '' : ` (PID: ${pid})`}...`)
  const stopped = await stopDaemonByPid(stateName)
  console.log(stopped ? 'daemon stopped' : 'daemon could not be stopped (may have already exited)')
}

function parseSupervisorArgs(args: string[]): SupervisorConfig {
  const config: SupervisorConfig = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dir' && i + 1 < args.length) {
      config.dir = resolve(args[++i])
    } else if (arg.startsWith('--dir=')) {
      config.dir = resolve(arg.slice('--dir='.length))
    } else if (arg === '--name' && i + 1 < args.length) {
      config.name = args[++i]
    } else if (arg.startsWith('--name=')) {
      config.name = arg.slice('--name='.length)
    } else if (arg === '--spawn-mode' && i + 1 < args.length) {
      config.spawnMode = args[++i]
    } else if (arg.startsWith('--spawn-mode=')) {
      config.spawnMode = arg.slice('--spawn-mode='.length)
    } else if (arg === '--capacity' && i + 1 < args.length) {
      config.capacity = args[++i]
    } else if (arg.startsWith('--capacity=')) {
      config.capacity = arg.slice('--capacity='.length)
    } else if (arg === '--permission-mode' && i + 1 < args.length) {
      config.permissionMode = args[++i]
    } else if (arg.startsWith('--permission-mode=')) {
      config.permissionMode = arg.slice('--permission-mode='.length)
    } else if (arg === '--sandbox') {
      config.sandbox = '1'
    }
  }
  return config
}

/**
 * Runs the supervisor loop until SIGTERM/SIGINT. Refuses to start when a live
 * daemon is already recorded — two supervisors would register duplicate bridge
 * environments under the same state name.
 */
async function runSupervisor(args: string[], stateName?: string): Promise<void> {
  const config = parseSupervisorArgs(args)
  const dir = config.dir || resolve('.')

  const existing = await queryDaemonStatus(stateName)
  if (existing.status === 'running') {
    console.log(`daemon already running (PID: ${existing.state?.pid ?? 'unknown'})`)
    return
  }

  console.log(`[daemon] supervisor starting in ${dir}`)

  const workers: WorkerState[] = [
    {
      kind: 'remoteControl',
      process: null,
      backoffMs: BACKOFF_INITIAL_MS,
      failureCount: 0,
      parked: false,
      lastStartTime: 0,
      restartTimer: null,
    },
  ]

  await writeDaemonState(
    {
      pid: process.pid,
      cwd: dir,
      startedAt: new Date().toISOString(),
      workerKinds: workers.map((worker) => worker.kind),
      lastStatus: 'running',
    },
    stateName,
  )

  const controller = new AbortController()

  // Keep the event loop alive on its own. Bun does not treat signal listeners
  // as ref'd handles, and the restart timer is unref'd, so without this the
  // supervisor would exit the moment a worker dies instead of restarting it.
  const keepAlive = setInterval(() => {}, 60_000)

  const shutdown = (): void => {
    if (controller.signal.aborted) return
    console.log('[daemon] supervisor shutting down...')
    controller.abort()
    for (const worker of workers) {
      if (worker.restartTimer) {
        clearTimeout(worker.restartTimer)
        worker.restartTimer = null
      }
      if (worker.process && worker.process.exitCode === null) {
        worker.process.kill('SIGTERM')
      }
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  for (const worker of workers) {
    if (!controller.signal.aborted) {
      spawnWorker(worker, dir, config, controller.signal, stateName)
    }
  }

  await new Promise<void>((resolveWait) => {
    if (controller.signal.aborted) {
      resolveWait()
      return
    }
    controller.signal.addEventListener('abort', () => resolveWait(), { once: true })
  })

  await Promise.all(workers.map((worker) => waitForWorkerExit(worker)))
  clearInterval(keepAlive)
  await removeDaemonState(stateName)

  process.off('SIGTERM', shutdown)
  process.off('SIGINT', shutdown)
  console.log('[daemon] supervisor stopped')
}

/** Waits for a worker to exit, SIGKILLing it after a grace period. */
function waitForWorkerExit(worker: WorkerState): Promise<void> {
  const child = worker.process
  if (!child || child.exitCode !== null) return Promise.resolve()

  return new Promise<void>((resolveWait) => {
    // The kill timer only escalates; the 'exit' handler is the sole resolver,
    // so SIGKILL always settles through the child's own exit event.
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, KILL_GRACE_MS)
    killTimer.unref?.()
    child.once('exit', () => {
      clearTimeout(killTimer)
      resolveWait()
    })
  })
}

/**
 * Spawns one worker child. Config travels via `DAEMON_WORKER_*` env vars; the
 * worker kind is a positional arg (`--daemon-worker <kind>`) because the CLI
 * fast-path matches the flag and kind as separate argv entries.
 */
function spawnWorker(
  worker: WorkerState,
  dir: string,
  config: SupervisorConfig,
  signal: AbortSignal,
  stateName: string | undefined,
): void {
  if (signal.aborted || worker.parked) return

  worker.lastStartTime = Date.now()

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DAEMON_WORKER_DIR: dir,
    DAEMON_WORKER_NAME: config.name,
    DAEMON_WORKER_SPAWN_MODE: config.spawnMode || 'same-dir',
    DAEMON_WORKER_CAPACITY: config.capacity || '4',
    DAEMON_WORKER_PERMISSION: config.permissionMode,
    DAEMON_WORKER_SANDBOX: config.sandbox || '0',
    DAEMON_WORKER_CREATE_SESSION: '1',
    CLAUDE_CODE_SESSION_KIND: 'daemon-worker',
  }

  console.log(`[daemon] spawning worker '${worker.kind}'`)

  const child = spawnCli(buildCliLaunch(['--daemon-worker', worker.kind]), {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  worker.process = child

  child.stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().trimEnd().split('\n')) {
      console.log(`  ${line}`)
    }
  })
  child.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().trimEnd().split('\n')) {
      console.error(`  ${line}`)
    }
  })
  // 'error' and 'exit' can both fire for one child; handle whichever lands
  // first and ignore the other.
  let finished = false

  child.on('error', (error) => {
    if (finished) return
    finished = true
    // A failed spawn emits 'error' but usually not 'exit', so clear the handle
    // here — otherwise waitForWorkerExit would wait out its grace period on a
    // process that never existed.
    if (worker.process === child) worker.process = null
    console.error(`[daemon] worker '${worker.kind}' failed to spawn: ${error.message}`)
    if (signal.aborted) return
    recordRapidFailure(worker, dir, config, signal, stateName)
  })

  child.on('exit', (code, signalName) => {
    if (finished) return
    finished = true
    worker.process = null
    if (signal.aborted) return

    if (code === EXIT_CODE_PERMANENT) {
      parkWorker(worker, 'exited with permanent error', stateName)
      return
    }

    console.log(`[daemon] worker '${worker.kind}' exited (code=${code}, signal=${signalName})`)
    const runDuration = Date.now() - worker.lastStartTime
    if (runDuration < RAPID_FAILURE_WINDOW_MS) {
      recordRapidFailure(worker, dir, config, signal, stateName)
    } else {
      worker.failureCount = 0
      worker.backoffMs = BACKOFF_INITIAL_MS
      scheduleRestart(worker, dir, config, signal, stateName)
    }
  })
}

/** Marks the worker parked and records it in the state file for `status`. */
function parkWorker(worker: WorkerState, reason: string, stateName: string | undefined): void {
  console.error(`[daemon] worker '${worker.kind}' ${reason} — parking`)
  worker.parked = true
  void markWorkerParked(worker.kind, stateName)
}

/** Counts a rapid failure; parks after MAX_RAPID_FAILURES, else backs off. */
function recordRapidFailure(
  worker: WorkerState,
  dir: string,
  config: SupervisorConfig,
  signal: AbortSignal,
  stateName: string | undefined,
): void {
  worker.failureCount++
  if (worker.failureCount >= MAX_RAPID_FAILURES) {
    parkWorker(worker, `failed ${worker.failureCount} times rapidly`, stateName)
    return
  }
  scheduleRestart(worker, dir, config, signal, stateName)
}

/** Schedules the next spawn after `worker.backoffMs`, then grows the backoff. */
function scheduleRestart(
  worker: WorkerState,
  dir: string,
  config: SupervisorConfig,
  signal: AbortSignal,
  stateName: string | undefined,
): void {
  console.log(`[daemon] worker '${worker.kind}' restarting in ${worker.backoffMs}ms`)
  worker.restartTimer = setTimeout(() => {
    worker.restartTimer = null
    if (!signal.aborted && !worker.parked) {
      spawnWorker(worker, dir, config, signal, stateName)
    }
  }, worker.backoffMs)
  worker.restartTimer.unref?.()

  worker.backoffMs = Math.min(worker.backoffMs * BACKOFF_MULTIPLIER, BACKOFF_CAP_MS)
}

/**
 * Persists the parked worker in the state file so `status` stops presenting a
 * supervisor whose only worker gave up as healthy.
 */
async function markWorkerParked(kind: string, stateName?: string): Promise<void> {
  const state = await readDaemonState(stateName)
  if (!state) return
  const parkedWorkers = state.parkedWorkers?.includes(kind)
    ? state.parkedWorkers
    : [...(state.parkedWorkers ?? []), kind]
  await writeDaemonState({ ...state, lastStatus: 'error', parkedWorkers }, stateName)
}
