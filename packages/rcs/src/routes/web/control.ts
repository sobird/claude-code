/**
 * Web control routes: user messages, control requests, and interrupts.
 *
 * All three resolve the session through the ownership helper, so an unknown or foreign
 * session yields 403 and an archived session yields 409 (`session_closed`). An `inactive`
 * session is revived to `idle` by the write, so a reaped conversation is resumable rather
 * than terminal. Published events are persisted before fan-out so reconnecting clients can
 * replay them.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '../../auth/context.js'
import { isSessionClosedStatus } from '../../contracts.js'
import {
  getSession,
  reactivateInactiveSession,
  resolveOwnedWebSessionId,
  updateSessionStatus,
} from '../../services/session.js'
import { getEventBus, publishSessionEvent } from '../../transport/event-bus.js'
import { legacyUserAuth, sessionClosed, webForbidden } from '../common.js'

const app = new Hono<AppEnv>()

type Ownership = { ok: true; sessionId: string } | { ok: false; response: Response }

async function checkOwnership(c: AppContext, requested: string): Promise<Ownership> {
  const repos = c.get('repos')
  if (!(await getSession(repos, requested))) {
    return { ok: false, response: webForbidden(c) }
  }
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return { ok: false, response: webForbidden(c) }

  const session = await getSession(repos, owned)
  if (!session) return { ok: false, response: webForbidden(c) }
  if (isSessionClosedStatus(session.status)) {
    return { ok: false, response: sessionClosed(c, session.status) }
  }
  await reactivateInactiveSession(repos, owned)
  return { ok: true, sessionId: owned }
}

/** POST /web/sessions/:id/events — Send a user message. */
app.post('/sessions/:id/events', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const body: unknown = await c.req.json().catch(() => ({}))
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const type = typeof record.type === 'string' && record.type ? record.type : 'user'
  const event = await publishSessionEvent(
    c.get('repos'),
    getEventBus(ownership.sessionId),
    ownership.sessionId,
    type,
    record,
    'outbound',
  )
  return c.json({ status: 'ok', event }, 200)
})

/** POST /web/sessions/:id/control — Send a control/permission response. */
app.post('/sessions/:id/control', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const body: unknown = await c.req.json().catch(() => ({}))
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const type = typeof record.type === 'string' && record.type ? record.type : 'control_request'
  const event = await publishSessionEvent(
    c.get('repos'),
    getEventBus(ownership.sessionId),
    ownership.sessionId,
    type,
    record,
    'outbound',
  )
  return c.json({ status: 'ok', event }, 200)
})

/** POST /web/sessions/:id/interrupt — Interrupt and mark the session idle. */
app.post('/sessions/:id/interrupt', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const repos = c.get('repos')
  await publishSessionEvent(
    repos,
    getEventBus(ownership.sessionId),
    ownership.sessionId,
    'interrupt',
    { action: 'interrupt' },
    'outbound',
  )
  await updateSessionStatus(repos, ownership.sessionId, 'idle')
  return c.json({ status: 'ok' }, 200)
})

export default app
