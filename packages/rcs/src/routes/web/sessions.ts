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
import { loadConfig } from '../../config.js'
import { isSessionClosedStatus, toWebSessionId } from '../../contracts.js'
import type { SessionRecord } from '../../contracts.js'
import { getAutomationStateSnapshot } from '../../services/automationState.js'
import {
  createSession,
  getSession,
  listAllSessions,
  listWebSessionsByOwner,
  resolveOwnedWebSessionId,
  toWebSessionResponse,
} from '../../services/session.js'
import { createWorkItem } from '../../services/work-dispatch.js'
import type { SessionEvent } from '../../transport/event-bus.js'
import { getEventBus } from '../../transport/event-bus.js'
import { forbidden, legacyUserAuth, notFound, readJson, resolveDispatchEnvironment, sessionClosed } from '../common.js'

const app = new Hono<AppEnv>()
const KEEPALIVE_MS = 15000
const DEFAULT_HISTORY_LIMIT = 100
const MAX_HISTORY_LIMIT = 1000

async function listVisibleRecords(c: AppContext): Promise<SessionRecord[]> {
  const repos = c.get('repos')
  const user = c.get('user')
  const records = user.role === 'admin' ? await listAllSessions(repos) : await repos.sessions.listByOwner(user.id)
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

function sseFrame(event: SessionEvent): string {
  const data = JSON.stringify({
    type: event.type,
    payload: event.payload,
    direction: event.direction,
    seqNum: event.seqNum,
  })
  return `id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

async function createWebStream(c: AppContext, sessionId: string, fromSeqNum: number): Promise<Response> {
  const repos = c.get('repos')
  const replayed =
    fromSeqNum > 0 ? await repos.events.listSince(sessionId, fromSeqNum, loadConfig().eventReplayLimit) : []
  const bus = getEventBus(sessionId)
  const encoder = new TextEncoder()
  let dispose = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsub = () => {}
      let keepalive: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (closed) return
        closed = true
        unsub()
        if (keepalive) clearInterval(keepalive)
      }
      dispose = cleanup

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      for (const record of replayed) {
        send(
          sseFrame({
            id: record.eventId,
            sessionId: record.sessionId,
            type: record.type,
            payload: record.payload,
            direction: record.direction,
            seqNum: record.id,
            createdAt: record.createdAt.getTime(),
          }),
        )
      }

      send(': keepalive\n\n')

      unsub = bus.subscribe((event) => send(sseFrame(event)))
      keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS)
      unrefTimer(keepalive)

      c.req.raw.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      dispose()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
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
    if (!access.environment) return notFound(c, 'Environment not found')
    if (access.forbiddenForCaller) return forbidden(c, 'Environment belongs to another user')
  }

  const session = await createSession(repos, {
    environmentId,
    ownerUserId: c.get('user').id,
    title: typeof body.title === 'string' && body.title ? body.title : 'New Session',
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
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  const session = await getSession(repos, owned)
  if (!session) return notFound(c)
  const worker = await repos.sessionWorkers.get(owned)
  const automationState = getAutomationStateSnapshot(worker?.externalMetadata)
  const response = toWebSessionResponse(session)
  return c.json(automationState === undefined ? response : { ...response, automation_state: automationState }, 200)
})

/** GET /web/sessions/:id/history — Paginated durable event history. */
app.get('/sessions/:id/history', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

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
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  const session = await getSession(repos, owned)
  if (!session) return notFound(c)
  if (isSessionClosedStatus(session.status)) return sessionClosed(c, session.status)

  const lastEventId = c.req.header('Last-Event-ID')
  const parsed = lastEventId ? Number.parseInt(lastEventId, 10) : 0
  const fromSeqNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  return createWebStream(c, owned, fromSeqNum)
})

export default app
