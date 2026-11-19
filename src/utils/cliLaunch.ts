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
