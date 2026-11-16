/**
 * V2 worker SSE stream.
 *
 * Emits `client_event` frames for outbound session events. Replay and live delivery are
 * handled by the shared transport (`createWorkerEventStream`): durable `session_events`
 * replay first, then the session bus, with the replay→live boundary deduped by seqNum.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { createWorkerEventStream } from '../../transport/sse-writer.js'
import { legacySessionIngressAuth, notFound } from '../common.js'

const app = new Hono<AppEnv>()

/** GET /v1/code/sessions/:id/worker/events/stream — Worker SSE stream. */
app.get('/:id/worker/events/stream', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  if (!(await repos.sessions.getById(sessionId))) return notFound(c)

  const lastEventId = c.req.header('Last-Event-ID')
  const fromParam = c.req.query('from_sequence_num') ?? lastEventId
  const parsed = fromParam ? Number.parseInt(fromParam, 10) : 0
  const fromSeqNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  return createWorkerEventStream(c, repos, sessionId, fromSeqNum)
})

export default app
