/**
 * V2 worker state routes.
 *
 * Worker-facing reads/writes authenticate with a worker token, an owning environment
 * token, or an owning API key (`sessionIngressAuth`). Registration is a user action and
 * bumps the worker epoch.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '../../auth/context.js'
import type { SessionWorkerRecord } from '../../contracts.js'
import { getAutomationStateEventPayload, automationStatesEqual } from '../../services/automationState.js'
import { getSession, incrementEpoch, resolveOwnedWebSessionId, updateSessionStatus } from '../../services/session.js'
import { getEventBus } from '../../transport/event-bus.js'
import { forbidden, legacySessionIngressAuth, legacyUserAuth, notFound, readJson } from '../common.js'

const app = new Hono<AppEnv>()

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toWorkerView(worker: SessionWorkerRecord | null, fallbackStatus: string) {
  return {
    worker_status: worker?.workerStatus ?? fallbackStatus,
    external_metadata: worker?.externalMetadata ?? null,
    requires_action_details: worker?.requiresActionDetails ?? null,
    last_heartbeat_at: worker?.lastHeartbeatAt?.toISOString() ?? null,
  }
}

/**
 * Persist the automation-state blob verbatim and notify any live stream. Unlike
 * `publishSessionEvent`, the payload is not normalized, so the wire shape stays strict.
 */
async function emitAutomationState(c: AppContext, sessionId: string, state: unknown) {
  const repos = c.get('repos')
  const persisted = await repos.events.append({
    sessionId,
    type: 'automation_state',
    payload: state,
    direction: 'inbound',
  })
  getEventBus(sessionId).publish({
    id: persisted.eventId,
    sessionId,
    type: 'automation_state',
    payload: state,
    direction: 'inbound',
    seqNum: persisted.id,
    createdAt: persisted.createdAt.getTime(),
  })
}

/** GET /v1/code/sessions/:id/worker — Read worker state. */
app.get('/:id/worker', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  const session = await getSession(repos, sessionId)
  if (!session) return notFound(c)
  const worker = await repos.sessionWorkers.get(sessionId)
  return c.json({ worker: toWorkerView(worker, session.status) }, 200)
})

/** PUT /v1/code/sessions/:id/worker — Update worker state. */
app.put('/:id/worker', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  const session = await getSession(repos, sessionId)
  if (!session) return notFound(c)

  const body = await readJson(c)
  const previous = await repos.sessionWorkers.get(sessionId)
  const prevAutomationState = getAutomationStateEventPayload(previous?.externalMetadata)

  const workerStatus = typeof body.worker_status === 'string' ? body.worker_status : null
  const externalMetadata = optionalRecord(body.external_metadata)
  const requiresActionDetails = optionalRecord(body.requires_action_details)

  if (workerStatus) {
    await updateSessionStatus(repos, sessionId, workerStatus)
  } else {
    await repos.sessions.update(sessionId, {})
  }

  const worker = await repos.sessionWorkers.upsert(sessionId, {
    workerStatus,
    externalMetadata,
    requiresActionDetails,
  })

  const nextAutomationState = getAutomationStateEventPayload(worker.externalMetadata)
  if (!automationStatesEqual(prevAutomationState, nextAutomationState)) {
    await emitAutomationState(c, sessionId, nextAutomationState)
  }

  return c.json({ status: 'ok', worker: toWorkerView(worker, session.status) }, 200)
})

/** POST /v1/code/sessions/:id/worker/heartbeat — Refresh the worker heartbeat. */
app.post('/:id/worker/heartbeat', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  if (!(await getSession(repos, sessionId))) return notFound(c)

  const now = new Date()
  await repos.sessionWorkers.upsert(sessionId, { lastHeartbeatAt: now })
  await repos.sessions.update(sessionId, {})
  return c.json({ status: 'ok', last_heartbeat_at: now.toISOString() }, 200)
})

/** POST /v1/code/sessions/:id/worker/register — Register a worker (user action). */
app.post('/:id/worker/register', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)
  return c.json({ worker_epoch: await incrementEpoch(repos, owned) }, 200)
})

export default app
