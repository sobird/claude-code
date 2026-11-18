/**
 * Web session routes.
 *
 * Listing is owner-scoped (admins see every owner). Detail and history enforce the same
 * ownership, and history reads durable events with a `before` cursor in display order.
 * The live stream replays durable events after `Last-Event-ID`, then fans out from the
 * in-process bus.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '../../auth/context.js'
import { isSessionClosedStatus, toWebSessionId } from '../../contracts.js'
import type { SessionRecord } from '../../contracts.js'
import { defaultSessionTitle, requestLocale } from '../../i18n/default-titles.js'
import { getAutomationStateSnapshot } from '../../services/automationState.js'
import { connectPresence, setPresenceVisible } from '../../services/presence.js'
import {
  createSession,
  getSession,
  listAllSessions,
  listWebSessionsByOwner,
  reactivateInactiveSession,
  resolveOwnedWebSessionId,
  toWebSessionResponse,
} from '../../services/session.js'
import { createWorkItem } from '../../services/work-dispatch.js'
import { createSSEStream } from '../../transport/sse-writer.js'
import {
  legacyUserAuth,
  readJson,
  resolveDispatchEnvironment,
  sessionClosed,
  webForbidden,
  webNotFound,
} from '../common.js'

const app = new Hono<AppEnv>()
const DEFAULT_HISTORY_LIMIT = 100
const MAX_HISTORY_LIMIT = 1000

async function listVisibleRecords(c: AppContext): Promise<SessionRecord[]> {
  const repos = c.get('repos')
  const user = c.get('user')
  let records: SessionRecord[]
  if (user.role === 'admin') {
    records = await listAllSessions(repos)
  } else {
    // Members see their own sessions plus legacy unowned ones (the shared
    // "Unclaimed" pool); dedupe by id in case a claim raced the reads.
    const byId = new Map<string, SessionRecord>()
    for (const record of await repos.sessions.listByOwner(user.id)) byId.set(record.id, record)
    for (const record of await repos.sessions.listUnowned()) byId.set(record.id, record)
    records = [...byId.values()]
  }
  return records.filter((record) => !isSessionClosedStatus(record.status))
}

function toSummary(record: SessionRecord) {
  return {
    id: toWebSessionId(record.id),
    title: record.title,
    status: record.status,
    owner_user_id: record.ownerUserId,
    updated_at: record.updatedAt.getTime() / 1000,
  }
}

function toHistoryEvent(event: {
  id: number
  eventId: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  createdAt: Date
}) {
  return {
    id: event.eventId,
    sessionId: event.sessionId,
    type: event.type,
    payload: event.payload,
    direction: event.direction,
    seqNum: event.id,
    createdAt: event.createdAt.getTime(),
  }
}

/** POST /web/sessions — Create a web session owned by the caller. */
app.post('/sessions', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const environmentId = typeof body.environment_id === 'string' ? body.environment_id : null
  if (environmentId) {
    // Web is a new surface: reject unknown environments outright and block members from
    // dispatching onto another user's environment.
    const access = await resolveDispatchEnvironment(c, environmentId)
    if (!access.environment) return webNotFound(c, 'Environment not found', 'environment_not_found')
    if (access.forbiddenForCaller)
      return webForbidden(c, 'Environment belongs to another user', 'environment_forbidden')
  }

  const session = await createSession(repos, {
    environmentId,
    ownerUserId: c.get('user').id,
    title:
      typeof body.title === 'string' && body.title
        ? body.title
        : defaultSessionTitle(requestLocale(c.req.header('accept-language'))),
    source: 'web',
    permissionMode: typeof body.permission_mode === 'string' ? body.permission_mode : 'default',
  })

  if (environmentId) {
    try {
      await createWorkItem(repos, environmentId, session.id)
    } catch {
      // Unknown/inactive environments must not fail creation.
    }
  }

  return c.json(session, 200)
})

/** GET /web/sessions — List the caller's open sessions. */
app.get('/sessions', legacyUserAuth, async (c) => {
  return c.json(await listWebSessionsByOwner(c.get('repos'), c.get('user')), 200)
})

/** GET /web/sessions/all — Compact summaries of the caller's open sessions. */
app.get('/sessions/all', legacyUserAuth, async (c) => {
  const records = await listVisibleRecords(c)
  return c.json(records.map(toSummary), 200)
})

/** GET /web/sessions/:id — Session detail with optional automation state. */
app.get('/sessions/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return webNotFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return webForbidden(c)

  const session = await getSession(repos, owned)
  if (!session) return webNotFound(c)
  const worker = await repos.sessionWorkers.get(owned)
  const automationState = getAutomationStateSnapshot(worker?.externalMetadata)
  const response = toWebSessionResponse(session)
  return c.json(automationState === undefined ? response : { ...response, automation_state: automationState }, 200)
})

/** GET /web/sessions/:id/history — Paginated durable event history. */
app.get('/sessions/:id/history', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return webNotFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return webForbidden(c)

  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT

  const beforeParam = Number.parseInt(c.req.query('before') ?? '', 10)
  let before: number
  if (Number.isFinite(beforeParam)) {
    before = beforeParam
  } else {
    const latest = await repos.events.latestId(owned)
    if (latest === null) return c.json({ events: [], nextBefore: null }, 200)
    before = latest + 1
  }

  const records = await repos.events.listBefore(owned, before, limit)
  const events = records.map(toHistoryEvent)
  const nextBefore = events.length === limit ? events[0].seqNum : null
  return c.json({ events, nextBefore }, 200)
})

/** GET /web/sessions/:id/events — Live SSE stream for the web UI. */
app.get('/sessions/:id/events', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return webNotFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return webForbidden(c)

  const session = await getSession(repos, owned)
  if (!session) return webNotFound(c)
  if (isSessionClosedStatus(session.status)) return sessionClosed(c, session.status)
  // Opening the stream is a resume signal: a reaped session comes back as `idle`.
  await reactivateInactiveSession(repos, owned)

  const lastEventId = c.req.header('Last-Event-ID')
  const parsed = lastEventId ? Number.parseInt(lastEventId, 10) : 0
  const fromSeqNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  // Presence lives as long as this stream: the page reports visibility on top
  // of it, and closing the connection drops the entry (no heartbeat needed).
  const clientId = (c.req.query('client_id') ?? '').trim().slice(0, 128)
  const release = clientId ? connectPresence(owned, clientId) : undefined
  return createSSEStream(c, repos, owned, fromSeqNum, release)
})

/** POST /web/sessions/:id/presence — Report whether this client can see the session. */
app.post('/sessions/:id/presence', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return webNotFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return webForbidden(c)

  const body = await readJson(c)
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim().slice(0, 128) : ''
  if (!clientId) return c.json({ error: 'client_id is required', code: 'client_id_required' }, 400)

  setPresenceVisible(owned, clientId, body.visible === true)
  return c.body(null, 204)
})

export default app
