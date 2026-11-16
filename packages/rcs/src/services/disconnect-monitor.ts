/**
 * Disconnect monitor.
 *
 * Periodically sweeps active environments and sessions:
 * - polling environments with a stale `last_poll_at` become `disconnected`;
 * - ACP agents (WebSocket keepalive, no polling) become `offline`;
 * - `running`/`idle` sessions with no update for 2× the disconnect window become
 *   `inactive` (and emit a `session_status` event).
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
    if (now - session.updatedAt.getTime() <= timeoutMs * 2) continue
    await updateSessionStatus(repos, session.id, 'inactive')
  }
}

export function startDisconnectMonitor({ repos, config }: StartDisconnectMonitorOptions): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    void runDisconnectMonitorSweep(repos, config)
  }, SWEEP_INTERVAL_MS)
  const handle = sweepTimer as { unref?: () => void }
  handle.unref?.()
}

export function stopDisconnectMonitor(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}
