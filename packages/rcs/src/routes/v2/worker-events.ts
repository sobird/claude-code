/**
 * V2 worker event and state-reporting routes.
 *
 * Events arrive either as a bare array, `{ events: [...] }`, or a CCR batch whose entries
 * wrap the real payload under `payload`. Every stored event is normalized and persisted
 * before it is published.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { getSession, updateSessionStatus } from '../../services/session.js'
import { getEventBus, publishInboundEvent } from '../../transport/event-bus.js'
import { legacySessionIngressAuth, notFound, readJson } from '../common.js'

const app = new Hono<AppEnv>()

interface WorkerEventEntry {
  event: Record<string, unknown>
  /** The client marks stream snapshots `ephemeral: true`: live-only, never persisted. */
  ephemeral: boolean
}

/** Unwrap CCR `{ events: [{ payload, ephemeral }] }` batches into events plus their flags. */
function extractWorkerEvents(body: unknown): WorkerEventEntry[] {
  const direct = body as Record<string, unknown> | null
  const candidates: unknown =
    direct && Array.isArray(direct.events) ? direct.events : Array.isArray(body) ? body : [body]

  return (candidates as unknown[])
    .filter((event): event is Record<string, unknown> => !!event && typeof event === 'object' && !Array.isArray(event))
    .map((entry) => {
      const wrapped = entry.payload
      const event =
        wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped) ? (wrapped as Record<string, unknown>) : entry
      return { event, ephemeral: entry.ephemeral === true }
    })
}

/** POST /v1/code/sessions/:id/worker/events — Persist worker-reported events. */
app.post('/:id/worker/events', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  if (!(await getSession(repos, sessionId))) return notFound(c)

  const body: unknown = await c.req.json().catch(() => [])
  const events = extractWorkerEvents(body)
  for (const { event, ephemeral } of events) {
    const type = typeof event.type === 'string' && event.type ? event.type : 'message'
    // Dedupe by message uuid: the bridge replays its buffer on reconnect. Ephemeral
    // stream snapshots are live-only, so they never enter durable history.
    await publishInboundEvent(repos, getEventBus(sessionId), sessionId, type, event, { ephemeral })
  }
  await repos.sessions.update(sessionId, {})
  return c.json({ status: 'ok', count: events.length }, 200)
})

/** PUT /v1/code/sessions/:id/worker/state — Report a session status change. */
app.put('/:id/worker/state', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  if (!(await getSession(repos, sessionId))) return notFound(c)
  const body = await readJson(c)
  if (typeof body.status === 'string' && body.status) {
    await updateSessionStatus(repos, sessionId, body.status)
  } else {
    await repos.sessions.update(sessionId, {})
  }
  return c.json({ status: 'ok' }, 200)
})

/** PUT /v1/code/sessions/:id/worker/external_metadata — Accepted for CCR compat. */
app.put('/:id/worker/external_metadata', legacySessionIngressAuth, async (c) => {
  if (!(await getSession(c.get('repos'), c.get('workerSessionId')))) return notFound(c)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/code/sessions/:id/worker/events/delivery — Delivery tracking no-op. */
app.post('/:id/worker/events/delivery', legacySessionIngressAuth, async (c) => {
  if (!(await getSession(c.get('repos'), c.get('workerSessionId')))) return notFound(c)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/code/sessions/:id/worker/events/:eventId/delivery — Per-event no-op. */
app.post('/:id/worker/events/:eventId/delivery', legacySessionIngressAuth, async (c) => {
  if (!(await getSession(c.get('repos'), c.get('workerSessionId')))) return notFound(c)
  return c.json({ status: 'ok' }, 200)
})

export default app
