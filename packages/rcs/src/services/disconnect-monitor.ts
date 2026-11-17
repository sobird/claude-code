/**
 * Disconnect monitor.
 *
 * Periodically sweeps active environments and sessions:
 * - polling environments with a stale `last_poll_at` become `disconnected`;
 * - ACP agents (WebSocket keepalive, no polling) become `offline`;
 * - `running`/`idle` sessions with no activity for 2× the disconnect window become
 *   `inactive` (and emit a `session_status` event). Activity is the newest of the session
 *   row, its event stream, and its environment's poll — see `isSessionStale`.
 */

import type { GatewayConfig } from '../config.js'
import type { Repositories } from '../db/repositories/types.js'
import { listAllSessions, updateSessionStatus } from './session.js'

export interface StartDisconnectMonitorOptions {
  repos: Repositories
  config: GatewayConfig
}

const SWEEP_INTERVAL_MS = 60_000

let sweepTimer: ReturnType<typeof setInterval> | null = null

export interface SessionStalenessInput {
  sessionUpdatedAt: Date
  latestEventAt: Date | null
  environmentLastPollAt: Date | null
  now: number
  timeoutMs: number
}

/**
 * A session is only dead when every liveness signal has been quiet for 2× the disconnect
 * window. The session row lags event traffic (ingest never touches it), and an `idle`
 * session legitimately waits on the user while its bridge keeps polling — judging death by
 * `updated_at` alone marks live conversations `inactive`, which is terminal for the user.
 */
export function isSessionStale(input: SessionStalenessInput): boolean {
  const windowMs = input.timeoutMs * 2
  const isFresh = (at: Date | null) => at !== null && input.now - at.getTime() <= windowMs
  if (isFresh(input.sessionUpdatedAt)) return false
  if (isFresh(input.latestEventAt)) return false
  if (isFresh(input.environmentLastPollAt)) return false
  return true
}

export async function runDisconnectMonitorSweep(
  repos: Repositories,
  config: GatewayConfig,
  now: number = Date.now(),
): Promise<void> {
  const timeoutMs = config.disconnectTimeout * 1000

  const environments = await repos.environments.listActive()
  for (const environment of environments) {
    if (!environment.lastPollAt || now - environment.lastPollAt.getTime() <= timeoutMs) continue
    if (environment.workerType === 'acp') {
      await repos.environments.update(environment.id, { status: 'offline' })
    } else {
      await repos.environments.update(environment.id, { status: 'disconnected' })
    }
  }

  const sessions = await listAllSessions(repos)
  for (const session of sessions) {
    if (session.status !== 'running' && session.status !== 'idle') continue
    // Skip the per-session lookups while the row itself is obviously recent.
    if (now - session.updatedAt.getTime() <= timeoutMs * 2) continue
    const latestEventAt = await repos.events.latestCreatedAt(session.id)
    const environment = session.environmentId ? await repos.environments.getById(session.environmentId) : null
    const stale = isSessionStale({
      sessionUpdatedAt: session.updatedAt,
      latestEventAt,
      environmentLastPollAt: environment?.lastPollAt ?? null,
      now,
      timeoutMs,
    })
    if (!stale) continue
    await updateSessionStatus(repos, session.id, 'inactive')
  }
}

export function startDisconnectMonitor({ repos, config }: StartDisconnectMonitorOptions): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    // Swallow failures so a transient DB error never becomes an unhandled rejection
    // that tears down the long-lived gateway; the next tick retries naturally.
    void runDisconnectMonitorSweep(repos, config).catch((error: unknown) => {
      console.error('[disconnect-monitor] sweep failed:', error)
    })
  }, SWEEP_INTERVAL_MS)
  const handle = sweepTimer as { unref?: () => void }
  handle.unref?.()
}

export function stopDisconnectMonitor(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}
