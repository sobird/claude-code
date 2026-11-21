/**
 * V1 session routes used by the CLI and the legacy web client.
 *
 * Responses keep the historical wire shape: creation returns a web-facing `session_…`
 * id, while reads accept either form and answer with the canonical `cse_…` row. Access
 * is owner-scoped (admins bypass) and unowned legacy sessions are claimed on first use.
 */

import { Hono } from 'hono'

import type { AppEnv } from '@/auth/context'
import { toCompatibleCodeSessionId } from '@/contracts'
import { forbidden, legacyUserAuth, notFound, readJson, resolveDispatchEnvironment } from '@/routes/common'
import {
  archiveSession,
  createSession,
  getSession,
  resolveOwnedWebSessionId,
  unarchiveSession,
  updateSessionTitle,
} from '@/services/session'
import { createWorkItem } from '@/services/work-dispatch'
import { getEventBus, publishInboundEvent, publishSessionEvent } from '@/transport/event-bus'

const app = new Hono<AppEnv>()

function canonicalId(sessionId: string): string {
  return toCompatibleCodeSessionId(sessionId) ?? sessionId
}

function extractEvents(body: unknown): Array<Record<string, unknown>> {
  const direct = body as Record<string, unknown> | null
  const candidates: unknown =
    direct && Array.isArray(direct.events) ? direct.events : Array.isArray(body) ? body : [body]
  return (candidates as unknown[]).filter(
    (event): event is Record<string, unknown> => !!event && typeof event === 'object' && !Array.isArray(event),
  )
}

/** POST /v1/sessions — Create a session, optionally dispatching work. */
app.post('/', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  const body = await readJson(c)

  const environmentId = typeof body.environment_id === 'string' ? body.environment_id : null
  if (environmentId) {
    // Guard against cross-tenant dispatch before creating anything. An unknown environment
    // keeps the legacy behavior: the session is still created and dispatch is skipped.
    const access = await resolveDispatchEnvironment(c, environmentId)
    if (access.forbiddenForCaller) return forbidden(c, 'Environment belongs to another user')
  }
  const session = await createSession(repos, {
    environmentId,
    ownerUserId: user.id,
    title: typeof body.title === 'string' ? body.title : null,
    source: typeof body.source === 'string' ? body.source : 'remote-control',
    permissionMode: typeof body.permission_mode === 'string' ? body.permission_mode : null,
  })

  if (environmentId) {
    try {
      await createWorkItem(repos, environmentId, session.id)
    } catch {
      // An unknown/inactive environment must not fail session creation.
    }
  }

  if (Array.isArray(body.events)) {
    const id = canonicalId(session.id)
    for (const entry of extractEvents(body.events)) {
      // The bridge wraps preloaded history as `{ type: 'event', data: SDKMessage }`.
      // Persist the SDK message itself; storing the wrapper would replay an event the
      // child's message normalizer cannot parse.
      const data = entry.data
      const event: Record<string, unknown> =
        entry.type === 'event' && data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : entry
      const type = typeof event.type === 'string' && event.type ? event.type : 'init'
      await publishSessionEvent(repos, getEventBus(id), id, type, event, 'outbound')
    }
  }

  return c.json(session, 200)
})

/** GET /v1/sessions/:id — Read a session the caller may access. */
app.get('/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)
  return c.json(await getSession(repos, owned), 200)
})

/** PATCH /v1/sessions/:id — Update the session title. */
app.patch('/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  const body = await readJson(c)
  if (typeof body.title === 'string' && body.title) {
    await updateSessionTitle(repos, owned, body.title)
  }
  return c.json(await getSession(repos, owned), 200)
})

/** POST /v1/sessions/:id/archive — Archive a session. */
app.post('/:id/archive', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  await archiveSession(repos, owned)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/sessions/:id/unarchive — Restore an archived session the caller owns. */
app.post('/:id/unarchive', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  await unarchiveSession(repos, owned)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/sessions/:id/events — Publish inbound events for a session. */
app.post('/:id/events', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  const body: unknown = await c.req.json().catch(() => ({}))
  const events = extractEvents(body)
  for (const event of events) {
    const type = typeof event.type === 'string' && event.type ? event.type : 'message'
    // Dedupe by message uuid: the bridge replays its buffer on reconnect.
    await publishInboundEvent(repos, getEventBus(owned), owned, type, event)
  }
  return c.json({ status: 'ok', events: events.length }, 200)
})

export default app
