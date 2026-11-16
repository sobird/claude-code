/**
 * Client payload conversion for the bridge transports.
 *
 * `toClientPayload` is the legacy SDK message shape the bridge worker's stdin parser
 * consumes over the WebSocket transport. `toWorkerClientPayload` / `toWorkerClientFrame`
 * produce the CCR `client_event` SSE frames consumed by the v2 worker stream.
 */

import type { SessionEvent } from './event-bus.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Convert an internal session event into the SDK/control message shape that bridge workers
 * consume on both the legacy WS path and the v2 worker SSE path.
 */
export function toClientPayload(event: SessionEvent): Record<string, unknown> {
  const payload = asRecord(event.payload)
  const messageUuid = typeof payload?.uuid === 'string' && payload.uuid ? payload.uuid : event.id

  if (event.type === 'user' || event.type === 'user_message') {
    return {
      type: 'user',
      uuid: messageUuid,
      session_id: event.sessionId,
      ...(payload?.isSynthetic === true ? { isSynthetic: true } : {}),
      message: {
        role: 'user',
        content: payload?.content ?? payload?.message ?? '',
      },
    }
  }

  if (event.type === 'permission_response' || event.type === 'control_response') {
    const approved = !!payload?.approved
    const existingResponse = asRecord(payload?.response)
    if (existingResponse) {
      return { type: 'control_response', response: existingResponse }
    }

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
    return {
      type: 'control_request',
      request_id: event.id,
      request: { subtype: 'interrupt' },
    }
  }

  if (event.type === 'control_request') {
    return {
      type: 'control_request',
      request_id: payload?.request_id ?? event.id,
      request: payload?.request ?? payload,
    }
  }

  return {
    type: event.type,
    uuid: messageUuid,
    session_id: event.sessionId,
    message: payload,
  }
}

/** Worker stream payload: control events keep the SDK shape, everything else flattens `raw`. */
export function toWorkerClientPayload(event: SessionEvent): Record<string, unknown> {
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

/** Serialize one outbound event as a CCR `client_event` SSE frame. */
export function toWorkerClientFrame(event: SessionEvent): string {
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

/** Serialize one event as a web-UI `message` SSE frame. */
export function toSessionEventFrame(event: SessionEvent): string {
  const data = JSON.stringify({
    type: event.type,
    payload: event.payload,
    direction: event.direction,
    seqNum: event.seqNum,
  })
  return `id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`
}
