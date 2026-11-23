/**
 * Relaunch helpers for spawning another CLI process — the assistant installer
 * launching the daemon supervisor, and the supervisor launching a worker.
 *
 * In a compiled Bun binary `process.execPath` is the claude binary itself, so
 * the extra args stand alone. Running from source, `process.execPath` is the
 * runtime (bun) and the child needs the script path plus the parent's runtime
 * flags (e.g. `--feature DAEMON`). Inspect flags are dropped: a child paused on
 * `--inspect-brk` would never reach its own code.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { constants } from 'node:os'
import { resolve } from 'node:path'

import { isInBundledMode } from './bundledMode.js'

export type CliLaunch = { command: string; args: string[] }

/**
 * Builds the command + args to invoke the CLI again with `extraArgs` appended.
 * `process.argv[1]` is resolved to an absolute path because callers spawn with
 * a different cwd than the current process.
 */
export function buildCliLaunch(extraArgs: string[]): CliLaunch {
  if (isInBundledMode() || !process.argv[1]) {
    return { command: process.execPath, args: extraArgs }
  }
  const runtimeArgs = process.execArgv.filter((arg) => !/^--inspect(-brk)?(=|$)/.test(arg))
  return { command: process.execPath, args: [...runtimeArgs, resolve(process.argv[1]), ...extraArgs] }
}

export function spawnCli(launch: CliLaunch, options: SpawnOptions): ChildProcess {
  return spawn(launch.command, launch.args, options)
}

/**
 * Replaces the current process with a fresh CLI invocation replaying the
 * original argv. Used after saving configuration that only takes effect on the
 * next start (e.g. switching the API provider to Vertex AI). Forwards
 * SIGINT/SIGTERM/SIGHUP to the child and mirrors its exit code; the returned
 * promise never resolves because the process exits when the child does.
 */
export async function execRelaunch(): Promise<never> {
  const child = spawnCli(buildCliLaunch(process.argv.slice(2)), { stdio: 'inherit', env: process.env })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      try {
        child.kill(signal)
      } catch {
        // Child already exited.
      }
    })
  }
  return new Promise<never>(() => {
    child.on('close', (code, signal) => {
      process.exit(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 0))
    })
    child.on('error', (error) => {
      process.stderr.write(`Failed to relaunch Claude Code: ${error.message}\n`)
      process.exit(1)
    })
  })
}
