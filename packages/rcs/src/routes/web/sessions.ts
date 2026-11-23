/**
 * Web session routes.
 *
 * Listing is owner-scoped (admins see every owner). Detail and history enforce the same
 * ownership, and history reads durable events with a `before` cursor in display order.
 * The live stream replays durable events after `Last-Event-ID`, then fans out from the
 * in-process bus.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '@/auth/context'
import { isSessionClosedStatus, toWebSessionId } from '@/contracts'
import type { SessionRecord } from '@/contracts'
import { defaultSessionTitle, requestLocale } from '@/i18n/default-titles'
import {
  jsonError,
  legacyUserAuth,
  readJson,
  resolveDispatchEnvironment,
  sessionClosed,
  webForbidden,
  webNotFound,
} from '@/routes/common'
import { getAutomationStateSnapshot } from '@/services/automationState'
import { connectPresence, setPresenceVisible } from '@/services/presence'
import {
  archiveSession,
  authorizeSessionWrite,
  createSession,
  getSession,
  listAllSessions,
  listWebSessionsByOwner,
  resolveAccessibleSession,
  toWebSessionResponse,
  unarchiveSession,
} from '@/services/session'
import { createWorkItem } from '@/services/work-dispatch'
import { createSSEStream } from '@/transport/sse-writer'

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
    environment_id: record.environmentId,
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

/**
 * GET /web/sessions/archived — 已归档会话。
 *
 * 必须注册在 `/sessions/:id` 之前（Hono 按注册顺序匹配）。成员只看到自己拥有的归档行，
 * 不并入 unowned：恢复 unowned 会话会顺带认领，留给 admin 处理。
 */
app.get('/sessions/archived', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  const records =
    user.role === 'admin'
      ? await listAllSessions(repos, { includeArchived: true })
      : await repos.sessions.listByOwner(user.id, { includeArchived: true })
  return c.json(records.filter((record) => isSessionClosedStatus(record.status)).map(toSummary), 200)
})

/** GET /web/sessions/:id — Session detail with optional automation state. */
app.get('/sessions/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  const access = await resolveAccessibleSession(repos, requested, c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)
  const owned = access.sessionId

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
  const access = await resolveAccessibleSession(repos, requested, c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)
  const owned = access.sessionId

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
  const access = await authorizeSessionWrite(repos, requested, c.get('user'))
  if (!access.ok) {
    if (access.reason === 'closed') return sessionClosed(c, access.status)
    return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)
  }
  const owned = access.sessionId

  const lastEventId = c.req.header('Last-Event-ID')
  const parsed = lastEventId ? Number.parseInt(lastEventId, 10) : 0
  const fromSeqNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  // Presence lives as long as this stream: the page reports visibility on top
  // of it, and closing the connection drops the entry (no heartbeat needed).
  const clientId = (c.req.query('client_id') ?? '').trim().slice(0, 128)
  const release = clientId ? connectPresence(owned, clientId) : undefined
  return createSSEStream(c, repos, owned, fromSeqNum, release)
})

/**
 * POST /web/sessions/:id/archive — 归档会话；有活动时拒绝并返回活动清单。
 *
 * 与 v1 同语义：不带 `stop_activity` 时先做活动守卫，命中则 409 `session_active`
 * 并在 `details.activity` 里列出占用项；带 `stop_activity: true` 时先写终态再停活动。
 * 已归档会话重复归档是幂等的。
 */
app.post('/sessions/:id/archive', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const access = await resolveAccessibleSession(repos, c.req.param('id'), c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)

  const body = await readJson(c)
  const result = await archiveSession(repos, access.sessionId, { stopActivity: body.stop_activity === true })
  if (!result.ok) {
    return jsonError(c, 'session_active', 'Session has active work', 409, 'session_active', {
      activity: result.activity,
    })
  }
  return c.json({ status: 'ok' }, 200)
})

/**
 * POST /web/sessions/:id/unarchive — 恢复已归档会话。
 *
 * `unarchiveSession` 会无条件把状态写成 `idle` 并追加事件，所以先做终态守卫：
 * 非归档会话直接 200 返回，不产生任何副作用（重复恢复幂等）。
 */
app.post('/sessions/:id/unarchive', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const access = await resolveAccessibleSession(repos, c.req.param('id'), c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)

  const session = await getSession(repos, access.sessionId)
  if (!session) return webNotFound(c)
  if (isSessionClosedStatus(session.status)) await unarchiveSession(repos, access.sessionId)
  return c.json({ status: 'ok' }, 200)
})

/** POST /web/sessions/:id/presence — Report whether this client can see the session. */
app.post('/sessions/:id/presence', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  const access = await resolveAccessibleSession(repos, requested, c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)
  const owned = access.sessionId

  const body = await readJson(c)
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim().slice(0, 128) : ''
  if (!clientId) return c.json({ error: 'client_id is required', code: 'client_id_required' }, 400)

  setPresenceVisible(owned, clientId, body.visible === true)
  return c.body(null, 204)
})

export default app
