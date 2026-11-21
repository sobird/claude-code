/**
 * Work dispatch service.
 *
 * Enqueueing writes a `pending` work item, signs the worker token embedded in the work
 * secret, and wakes any poller waiting on the environment. Polling claims at most one
 * item per check and then waits on the in-process notifier until work arrives or the
 * configured timeout elapses.
 */

import { Buffer } from 'node:buffer'

import { signWorkerToken } from '@/auth/tokens'
import { loadConfig } from '@/config'
import { toCompatibleCodeSessionId, type WorkItemRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'

import { notifyWorkAvailable, waitForWorkAvailable } from './transport.js'

/**
 * Lease window used when a poll omits `reclaim_older_than_ms`. Matches the upstream
 * server default (`work_service.py:24`) and the bridge client's `pollConfigDefaults.ts`.
 */
export const DEFAULT_RECLAIM_OLDER_THAN_MS = 5000

export interface WorkResponse {
  id: string
  type: 'work'
  environment_id: string
  state: string
  data: { type: 'session'; id: string }
  secret: string
  created_at: string
}

export interface HeartbeatResponse {
  lease_extended: boolean
  state: string
  last_heartbeat: string
  ttl_seconds: number
}

interface WorkSecretPayload {
  version: 1
  session_ingress_token: string
  api_base_url: string
  sources: string[]
  auth: string[]
  use_code_sessions: false
}

function encodeWorkSecret(sessionIngressToken: string, apiBaseUrl: string): string {
  const payload: WorkSecretPayload = {
    version: 1,
    session_ingress_token: sessionIngressToken,
    api_base_url: apiBaseUrl,
    sources: [],
    auth: [],
    use_code_sessions: false,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function toWorkResponse(item: WorkItemRecord): WorkResponse {
  return {
    id: item.id,
    type: 'work',
    environment_id: item.environmentId,
    state: item.state,
    data: { type: 'session', id: item.sessionId },
    secret: item.secret,
    created_at: item.createdAt.toISOString(),
  }
}

/** Map a web `session_…` id to its canonical `cse_…` row so the FK and token match. */
async function canonicalSessionId(repos: Repositories, sessionId: string): Promise<string> {
  if (await repos.sessions.getById(sessionId)) return sessionId
  const compatibleId = toCompatibleCodeSessionId(sessionId)
  if (compatibleId && (await repos.sessions.getById(compatibleId))) return compatibleId
  throw new Error(`Session ${sessionId} not found`)
}

export async function createWorkItem(repos: Repositories, environmentId: string, sessionId: string): Promise<string> {
  const environment = await repos.environments.getById(environmentId)
  if (!environment) {
    throw new Error(`Environment ${environmentId} not found`)
  }
  if (environment.status !== 'active') {
    throw new Error(`Environment ${environmentId} is not active (status: ${environment.status})`)
  }

  const canonicalId = await canonicalSessionId(repos, sessionId)
  const config = loadConfig()
  const sessionIngressToken = await signWorkerToken(canonicalId, config.jwtExpiresIn)
  const record = await repos.workItems.enqueue({
    environmentId,
    sessionId: canonicalId,
    secret: encodeWorkSecret(sessionIngressToken, config.baseUrl),
  })
  notifyWorkAvailable(environmentId)
  return record.id
}

/**
 * Long-poll for work. Claims once; when nothing is pending, waits on the environment
 * notifier until an item is enqueued or the timeout elapses, then claims again.
 *
 * `reclaimOlderThanMs` is the client's `reclaim_older_than_ms` lease window: dispatched
 * work older than it is re-delivered. It defaults to `DEFAULT_RECLAIM_OLDER_THAN_MS`; an
 * invalid value falls back to that default rather than disabling recovery.
 */
export async function pollWork(
  repos: Repositories,
  environmentId: string,
  timeoutSeconds?: number,
  reclaimOlderThanMs?: number,
): Promise<WorkResponse | null> {
  const config = loadConfig()
  // Query-param-derived values can arrive as NaN/Infinity/negative; fall back to the
  // configured timeout so a bad value cannot tight-spin or wait forever.
  const requested = timeoutSeconds ?? config.pollTimeout
  const timeout = Number.isFinite(requested) && requested >= 0 ? requested : config.pollTimeout
  const requestedReclaim = reclaimOlderThanMs ?? DEFAULT_RECLAIM_OLDER_THAN_MS
  const reclaimWindow =
    Number.isFinite(requestedReclaim) && requestedReclaim > 0 ? requestedReclaim : DEFAULT_RECLAIM_OLDER_THAN_MS
  const deadline = Date.now() + timeout * 1000

  for (;;) {
    const item = await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: reclaimWindow })
    if (item) return toWorkResponse(item)

    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    await waitForWorkAvailable(environmentId, remaining)
  }
}

export async function ackWork(repos: Repositories, workId: string): Promise<void> {
  await repos.workItems.setState(workId, 'acked')
}

export async function stopWork(repos: Repositories, workId: string): Promise<void> {
  await repos.workItems.setState(workId, 'completed')
}

export async function heartbeatWork(repos: Repositories, workId: string): Promise<HeartbeatResponse> {
  const config = loadConfig()
  await repos.workItems.bump(workId)
  const item = await repos.workItems.getById(workId)
  return {
    lease_extended: true,
    state: item?.state ?? 'acked',
    last_heartbeat: new Date().toISOString(),
    ttl_seconds: config.heartbeatInterval * 2,
  }
}

/** Re-queue every idle session attached to an environment (bridge reconnect). */
export async function reconnectWorkForEnvironment(repos: Repositories, environmentId: string): Promise<string[]> {
  const sessions = await repos.sessions.listByEnvironment(environmentId)
  const idle = sessions.filter((session) => session.status === 'idle')
  return Promise.all(idle.map((session) => createWorkItem(repos, environmentId, session.id)))
}
