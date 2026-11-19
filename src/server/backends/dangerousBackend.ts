/**
 * The default (and only) direct-connect backend: run the real agent as a child
 * CLI in the SDK stdio protocol.
 *
 * "Dangerous" refers to spawning a full, unsandboxed `claude` process in the
 * requested working directory — the server owns the machine, so this is the
 * agent that actually reads/writes files and runs tools. Permission prompts are
 * delegated to the connected client over WebSocket via
 * `--permission-prompt-tool stdio` unless the session was created with
 * `--dangerously-skip-permissions`.
 *
 * Protocol: NDJSON on stdin/stdout, identical to `claude --print
 * --input-format stream-json --output-format stream-json`.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { buildCliLaunch, type CliLaunch } from '../../utils/cliLaunch.js'
import type { BackendExitInfo, BackendSession, BackendSpawnOpts, SessionBackend } from '../sessionManager.js'

const MAX_STDERR_LINES = 20

/** CLI flags for a direct-connect session child. */
export function buildSessionArgs(opts: BackendSpawnOpts): string[] {
  const args = [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-prompt-tool',
    'stdio',
    '--session-id',
    opts.sessionId,
  ]
  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  } else if (opts.permissionMode) {
    args.push('--permission-mode', opts.permissionMode)
  }
  return args
}

export interface DangerousBackendOptions {
  /** Override how the child argv is assembled (tests inject a fake CLI). */
  buildLaunch?: (args: string[]) => CliLaunch
  spawnFn?: typeof spawn
  env?: NodeJS.ProcessEnv
}

export class DangerousBackend implements SessionBackend {
  private readonly buildLaunch: (args: string[]) => CliLaunch
  private readonly spawnFn: typeof spawn
  private readonly env: NodeJS.ProcessEnv | undefined

  constructor(options: DangerousBackendOptions = {}) {
    this.buildLaunch = options.buildLaunch ?? buildCliLaunch
    this.spawnFn = options.spawnFn ?? spawn
    this.env = options.env
  }

  spawn(opts: BackendSpawnOpts): BackendSession {
    const launch = this.buildLaunch(buildSessionArgs(opts))
    const child: ChildProcess = this.spawnFn(launch.command, launch.args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env ?? process.env,
      windowsHide: true,
    })

    let lineHandler: ((line: string) => void) | undefined
    let exitHandler: ((info: BackendExitInfo) => void) | undefined
    let exitInfo: BackendExitInfo | undefined
    const stderrTail: string[] = []

    if (child.stderr) {
      const stderrLines = createInterface({ input: child.stderr })
      stderrLines.on('line', (line) => {
        if (stderrTail.length >= MAX_STDERR_LINES) stderrTail.shift()
        stderrTail.push(line)
      })
    }

    if (child.stdout) {
      const stdoutLines = createInterface({ input: child.stdout })
      stdoutLines.on('line', (line) => lineHandler?.(line))
    }

    child.on('close', (code, signal) => {
      exitInfo = { code, signal }
      exitHandler?.(exitInfo)
    })

    return {
      pid: child.pid,
      writeStdin(data: string): void {
        if (child.stdin && !child.stdin.destroyed) child.stdin.write(data)
      },
      onLine(cb: (line: string) => void): void {
        lineHandler = cb
      },
      onExit(cb: (info: BackendExitInfo) => void): void {
        exitHandler = cb
        if (exitInfo) cb(exitInfo)
      },
      kill(): void {
        if (child.killed) return
        if (process.platform === 'win32') child.kill()
        else child.kill('SIGTERM')
      },
      getStderrTail(): string {
        return stderrTail.join('\n')
      },
    }
  }
}
