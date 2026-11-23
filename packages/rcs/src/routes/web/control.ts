/**
 * Web control routes: user messages, control requests, and interrupts.
 *
 * All three resolve the session through the ownership helper, so an unknown or foreign
 * session yields 403 and an archived session yields 409 (`session_closed`). An `inactive`
 * session is revived to `idle` by the write, so a reaped conversation is resumable rather
 * than terminal. Published events are persisted before fan-out so reconnecting clients can
 * replay them.
 */

import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '@/auth/context'
import { MAX_SIDE_QUESTION_LENGTH } from '@/lib/side-question'
import { jsonError, legacyUserAuth, sessionClosed, webForbidden } from '@/routes/common'
import { authorizeSessionWrite, updateSessionStatus } from '@/services/session'
import {
  BRIDGE_CONTROL_TIMEOUT_MS,
  cancelBridgeRequest,
  modelOptionsFromResponse,
  queueUpdateOutcomeFromResponse,
  requestBridgeControl,
  sideQuestionAnswerFromResponse,
  sideQuestionErrorFromResponse,
  suggestionPathsFromResponse,
} from '@/transport/bridge-requests'
import { getEventBus, publishSessionEvent } from '@/transport/event-bus'
import { loadModelCatalog } from '@/transport/model-catalog'
import { sendToBridge } from '@/transport/ws-handler'

const app = new Hono<AppEnv>()

type Ownership = { ok: true; sessionId: string } | { ok: false; response: Response }

/**
 * 控制写入的会话守卫。未知会话在这里也按 403 处理（沿用历史行为，避免向未认证者
 * 区分“不存在”和“不属于你”），归档会话返回 409。
 */
async function checkOwnership(c: AppContext, requested: string): Promise<Ownership> {
  const access = await authorizeSessionWrite(c.get('repos'), requested, c.get('user'))
  if (access.ok) return access
  if (access.reason === 'closed') return { ok: false, response: sessionClosed(c, access.status) }
  return { ok: false, response: webForbidden(c) }
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

/** Longest completion query forwarded to the bridge; the CLI index caps far lower. */
const MAX_SUGGESTION_QUERY_LENGTH = 256

/**
 * GET /web/sessions/:id/file-suggestions?q= — `@` file completion.
 *
 * The request is written straight to the session's live bridge socket and awaited through
 * the in-memory broker, so typing never grows `session_events`. A missing bridge or a slow
 * child degrades to an empty list rather than an error: completion is best-effort.
 */
app.get('/sessions/:id/file-suggestions', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const query = (c.req.query('q') ?? '').slice(0, MAX_SUGGESTION_QUERY_LENGTH)
  const requestId = `fs_${randomUUID()}`
  const pending = requestBridgeControl(
    ownership.sessionId,
    requestId,
    { subtype: 'file_suggestions', query },
    BRIDGE_CONTROL_TIMEOUT_MS,
  )
  const sent = sendToBridge(ownership.sessionId, {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'file_suggestions', query },
  })
  if (!sent) {
    cancelBridgeRequest(ownership.sessionId, requestId)
    return c.json({ suggestions: [] }, 200)
  }

  const response = await pending
  return c.json({ suggestions: suggestionPathsFromResponse(response) }, 200)
})

/** A forked agent answers `/btw` against the cached context; give it room. */
const SIDE_QUESTION_TIMEOUT_MS = 180_000

/**
 * POST /web/sessions/:id/side-question — `/btw` aside.
 *
 * Like file completion, the request is written straight to the live bridge and
 * awaited through the in-memory broker, so the exchange never touches
 * `session_events`: the answer shows in a transient card and is gone on
 * refresh. Unlike completion, a missing bridge is an explicit error — the user
 * asked a question and expects an answer, not a silent empty result.
 */
app.post('/sessions/:id/side-question', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const body: unknown = await c.req.json().catch(() => ({}))
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const question = typeof record.question === 'string' ? record.question.trim().slice(0, MAX_SIDE_QUESTION_LENGTH) : ''
  if (!question) {
    return jsonError(c, 'invalid_request', 'A question is required', 400, 'invalid_question')
  }

  const requestId = `sq_${randomUUID()}`
  const pending = requestBridgeControl(
    ownership.sessionId,
    requestId,
    { subtype: 'side_question', question },
    SIDE_QUESTION_TIMEOUT_MS,
  )
  const sent = sendToBridge(ownership.sessionId, {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'side_question', question },
  })
  if (!sent) {
    cancelBridgeRequest(ownership.sessionId, requestId)
    return jsonError(c, 'bridge_unavailable', 'No live bridge for this session', 409, 'bridge_unavailable')
  }

  const response = await pending
  if (!response) {
    return jsonError(c, 'side_question_timeout', 'The side question timed out', 504, 'side_question_timeout')
  }
  const error = sideQuestionErrorFromResponse(response)
  if (error) return jsonError(c, 'side_question_failed', error, 502, 'side_question_failed')
  return c.json({ answer: sideQuestionAnswerFromResponse(response) }, 200)
})

/**
 * GET /web/sessions/:id/models — Model list for the header switcher.
 *
 * The list comes from a server-initiated `initialize` control request over the live
 * bridge socket and is cached per session: the CLI answers `initialize` only once per
 * connection, so a second call would fail. A missing bridge or a timeout returns an
 * empty list that is not cached (reopening retries); the UI then falls back to a
 * free-form model id.
 */
app.get('/sessions/:id/models', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const models = await loadModelCatalog(ownership.sessionId, async () => {
    const requestId = `mdl_${randomUUID()}`
    const pending = requestBridgeControl(
      ownership.sessionId,
      requestId,
      { subtype: 'initialize' },
      BRIDGE_CONTROL_TIMEOUT_MS,
    )
    const sent = sendToBridge(ownership.sessionId, {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'initialize' },
    })
    if (!sent) {
      cancelBridgeRequest(ownership.sessionId, requestId)
      return null
    }
    const response = await pending
    return response ? modelOptionsFromResponse(response) : null
  })
  return c.json({ models }, 200)
})

/**
 * POST /web/sessions/:id/queue — 编辑、删除或插话一条排队消息。
 *
 * 队列在 CLI 内存里，网关只做协议转发：请求走实时 bridge 与内存 broker，
 * 不写 `session_events`（真正的状态变化由 CLI 的 `queue_snapshot` 推送落盘）。
 */
app.post('/sessions/:id/queue', legacyUserAuth, async (c) => {
  const ownership = await checkOwnership(c, c.req.param('id'))
  if (!ownership.ok) return ownership.response

  const body: unknown = await c.req.json().catch(() => ({}))
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const action =
    record.action === 'edit' || record.action === 'remove' || record.action === 'steer' ? record.action : null
  if (!action) {
    return jsonError(c, 'invalid_request', 'action must be edit, remove, or steer', 400, 'invalid_action')
  }
  const uuid = typeof record.uuid === 'string' ? record.uuid.trim() : ''
  if (!uuid) return jsonError(c, 'invalid_request', 'A queue item uuid is required', 400, 'invalid_uuid')
  const content = typeof record.content === 'string' ? record.content : undefined

  const requestId = `q_${randomUUID()}`
  const request = {
    subtype: 'queue_update',
    action,
    uuid,
    ...(content !== undefined ? { content } : {}),
  }
  const pending = requestBridgeControl(ownership.sessionId, requestId, request, BRIDGE_CONTROL_TIMEOUT_MS)
  const sent = sendToBridge(ownership.sessionId, {
    type: 'control_request',
    request_id: requestId,
    request,
  })
  if (!sent) {
    cancelBridgeRequest(ownership.sessionId, requestId)
    return jsonError(c, 'bridge_unavailable', 'No live bridge for this session', 409, 'bridge_unavailable')
  }

  const response = await pending
  if (!response) {
    return jsonError(c, 'queue_timeout', 'The queue update timed out', 504, 'queue_timeout')
  }
  const outcome = queueUpdateOutcomeFromResponse(response)
  if (!outcome) {
    return jsonError(c, 'queue_failed', 'The bridge returned an invalid queue response', 502, 'queue_failed')
  }
  if (!outcome.ok) {
    switch (outcome.error) {
      case 'invalid-content':
        return jsonError(c, 'invalid_request', 'Content cannot be empty', 400, 'invalid_content')
      case 'queue-item-not-found':
        return jsonError(c, 'not_found', 'That queued message is gone', 404, 'queue_item_not_found')
      case 'steer-unavailable':
        return jsonError(c, 'conflict', 'Steering is only available while a turn is running', 409, 'steer_unavailable')
      default:
        return jsonError(c, 'queue_failed', outcome.error, 502, 'queue_failed')
    }
  }
  return c.json({ status: 'ok', queue: outcome.queue }, 200)
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
