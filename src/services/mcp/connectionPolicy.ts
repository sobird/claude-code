import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export const MCP_CONNECT_TIMEOUT_MS = 5_000

export function isMcpConnectionNonblocking(env: Record<string, string | undefined>): boolean {
  return isEnvTruthy(env.MCP_CONNECTION_NONBLOCKING)
}

export function shouldBlockOnMcpConnect(opts: { env: Record<string, string | undefined> }): boolean {
  return !isMcpConnectionNonblocking(opts.env)
}

/**
 * Wait for an MCP connect promise to settle, but no longer than `timeoutMs`.
 * When MCP_CONNECTION_NONBLOCKING is truthy, skip the wait entirely so the
 * connection continues fully in the background. The connection promise keeps
 * running after we return either way; callers only bound how long startup
 * blocks on it.
 */
export async function waitForMcpConnect(
  promise: Promise<void>,
  label: string,
  opts: { env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<void> {
  const env = opts.env ?? process.env
  const timeoutMs = opts.timeoutMs ?? MCP_CONNECT_TIMEOUT_MS

  if (isMcpConnectionNonblocking(env)) {
    logForDebugging(`[MCP] ${label} running fully async (MCP_CONNECTION_NONBLOCKING)`)
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = await Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, true)
    }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  if (timedOut) {
    logForDebugging(`[MCP] ${label} not ready after ${timeoutMs}ms — proceeding; background connection continues`)
  }
}
