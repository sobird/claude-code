/**
 * V2 worker SSE stream.
 *
 * Emits `client_event` frames for outbound session events. Replay uses the durable
 * `session_events` table (never a second in-process bus) and live delivery uses the
 * shared session event bus. Control events are normalized into the SDK control-message
 * shapes the bridge worker expects.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '../../auth/context.js'
import { loadConfig } from '../../config.js'
import type { SessionEvent } from '../../transport/event-bus.js'
import { getEventBus } from '../../transport/event-bus.js'
import { legacySessionIngressAuth, notFound } from '../common.js'

const app = new Hono<AppEnv>()
const KEEPALIVE_MS = 15000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Mirrors the legacy client-payload conversion for control/permission events. */
function toClientPayload(event: SessionEvent): Record<string, unknown> {
  const payload = asRecord(event.payload)
  const messageUuid = typeof payload?.uuid === 'string' && payload.uuid ? payload.uuid : event.id

  if (event.type === 'user' || event.type === 'user_message') {
    return {
      type: 'user',
      uuid: messageUuid,
      session_id: event.sessionId,
      ...(payload?.isSynthetic === true ? { isSynthetic: true } : {}),
      message: { role: 'user', content: payload?.content ?? payload?.message ?? '' },
    }
  }

  if (event.type === 'permission_response' || event.type === 'control_response') {
    const approved = !!payload?.approved
    const existingResponse = asRecord(payload?.response)
    if (existingResponse) return { type: 'control_response', response: existingResponse }

    const updatedInput = asRecord(payload?.updated_input)
    const updatedPermissions = Array.isArray(payload?.updated_permissions)
      ? (payload?.updated_permissions as Record<string, unknown>[])
      : undefined
    const feedbackMessage = typeof payload?.message === 'string' ? payload.message : undefined

    return {
      type: 'control_response',
      response: {
        subtype: approved ? 'success' : 'error',
        request_id: payload?.request_id ?? '',
        ...(approved
          ? {
              response: {
                behavior: 'allow' as const,
                ...(updatedInput ? { updatedInput } : {}),
                ...(updatedPermissions ? { updatedPermissions } : {}),
              },
            }
          : {
              error: 'Permission denied by user',
              response: { behavior: 'deny' as const },
              ...(feedbackMessage ? { message: feedbackMessage } : {}),
            }),
      },
    }
  }

  if (event.type === 'interrupt') {
    return { type: 'control_request', request_id: event.id, request: { subtype: 'interrupt' } }
  }

  if (event.type === 'control_request') {
    return {
      type: 'control_request',
      request_id: payload?.request_id ?? event.id,
      request: payload?.request ?? payload,
    }
  }

  return { type: event.type, uuid: messageUuid, session_id: event.sessionId, message: payload }
}

function toWorkerClientPayload(event: SessionEvent): Record<string, unknown> {
  if (
    event.type === 'permission_response' ||
    event.type === 'control_response' ||
    event.type === 'control_request' ||
    event.type === 'interrupt'
  ) {
    return toClientPayload(event)
  }

  const normalized = asRecord(event.payload)
  const raw = asRecord(normalized?.raw)
  const base = raw ?? normalized
  const payload: Record<string, unknown> = base ? { ...base, type: event.type } : { type: event.type }

  if (event.type === 'user') {
    const message = asRecord(payload.message)
    if (!message || !('content' in message)) {
      const content =
        typeof normalized?.content === 'string'
          ? normalized.content
          : typeof payload.content === 'string'
            ? payload.content
            : typeof event.payload === 'string'
              ? event.payload
              : ''
      payload.content = content
      payload.message = { content }
    }
  }

  return payload
}

function toWorkerClientFrame(event: SessionEvent): string {
  const data = JSON.stringify({
    event_id: event.id,
    sequence_num: event.seqNum,
    event_type: event.type,
    source: 'client',
    payload: toWorkerClientPayload(event),
    created_at: new Date(event.createdAt).toISOString(),
  })
  return `id: ${event.seqNum}\nevent: client_event\ndata: ${data}\n\n`
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

async function createWorkerStream(c: AppContext, sessionId: string, fromSeqNum: number): Promise<Response> {
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
        if (record.direction !== 'outbound') continue
        send(
          toWorkerClientFrame({
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

      unsub = bus.subscribe((event) => {
        if (event.direction !== 'outbound') return
        send(toWorkerClientFrame(event))
      })

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

/** GET /v1/code/sessions/:id/worker/events/stream — Worker SSE stream. */
app.get('/:id/worker/events/stream', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')
  if (!(await repos.sessions.getById(sessionId))) return notFound(c)

  const lastEventId = c.req.header('Last-Event-ID')
  const fromParam = c.req.query('from_sequence_num') ?? lastEventId
  const parsed = fromParam ? Number.parseInt(fromParam, 10) : 0
  const fromSeqNum = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  return createWorkerStream(c, sessionId, fromSeqNum)
})

export default app
