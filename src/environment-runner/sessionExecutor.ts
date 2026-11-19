/**
 * Spawn and supervise the single Claude Code child process for a BYOC session.
 *
 * Unlike the bridge (`bridge/sessionRunner.ts`), the runner owns exactly one
 * session and never relays permissions itself: the child is launched with
 * `--sdk-url`, so its `RemoteIO` talks to Session Ingress / CCR directly and
 * routes permission prompts through the server. The runner only streams the
 * child's stdout/stderr (env-manager collects logs) and maps its exit into a
 * session status.
 */

import { type ChildProcess, spawn } from 'node:child_process'

export interface SessionLaunch {
  command: string
  args: string[]
}

export type SessionStatus = 'completed' | 'failed' | 'interrupted'

export interface SessionExecutionResult {
  status: SessionStatus
  code: number | null
  signal: NodeJS.Signals | null
}

export interface ExecuteSessionOptions {
  launch: SessionLaunch
  cwd: string
  env: NodeJS.ProcessEnv
  /** Aborting terminates the child (SIGTERM, then SIGKILL after the grace). */
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  /** Grace period between SIGTERM and SIGKILL on abort. Defaults to 5s. */
  killGraceMs?: number
}

/**
 * Spawn the child and resolve once it exits. Abort races are handled by
 * remembering that we initiated termination, so a SIGTERM exit is reported as
 * `interrupted` rather than `failed` (mirrors `sessionRunner.ts`).
 */
export function executeSession(options: ExecuteSessionOptions): Promise<SessionExecutionResult> {
  const { launch, cwd, env, signal } = options
  const onStdout = options.onStdout ?? ((chunk: string) => void process.stdout.write(chunk))
  const onStderr = options.onStderr ?? ((chunk: string) => void process.stderr.write(chunk))
  const killGraceMs = options.killGraceMs ?? 5_000

  return new Promise((resolve) => {
    const child: ChildProcess = spawn(launch.command, launch.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (chunk: Buffer) => onStdout(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => onStderr(chunk.toString()))

    let aborted = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    const terminate = (): void => {
      aborted = true
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }, killGraceMs)
      killTimer.unref?.()
    }

    if (signal) {
      if (signal.aborted) terminate()
      else signal.addEventListener('abort', terminate, { once: true })
    }

    let settled = false
    const finish = (status: SessionStatus, code: number | null, sig: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', terminate)
      resolve({ status, code, signal: sig })
    }

    child.on('error', () => finish('failed', null, null))
    child.on('close', (code, sig) => {
      if (aborted || sig === 'SIGTERM' || sig === 'SIGINT') {
        finish('interrupted', code, sig)
      } else if (code === 0) {
        finish('completed', 0, sig)
      } else {
        finish('failed', code, sig)
      }
    })
  })
}
