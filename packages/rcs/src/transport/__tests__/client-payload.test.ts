import { describe, expect, test } from 'bun:test'

import { toClientPayload } from '../client-payload.js'
import type { SessionEvent } from '../event-bus.js'

function makeEvent(overrides: Partial<SessionEvent> & Pick<SessionEvent, 'type' | 'sessionId'>): SessionEvent {
  return {
    id: 'evt-1',
    payload: null,
    direction: 'inbound',
    seqNum: 1,
    createdAt: Date.now(),
    ...overrides,
  }
}

// =============================================================================
// user / user_message
// =============================================================================

describe('toClientPayload — user message', () => {
  test('maps user type with content', () => {
    const result = toClientPayload(makeEvent({ type: 'user', sessionId: 'sess-1', payload: { content: 'hello' } }))
    expect(result.type).toBe('user')
    expect(result.session_id).toBe('sess-1')
    expect((result as { message: { role: string; content: string } }).message.role).toBe('user')
    expect((result as { message: { content: string } }).message.content).toBe('hello')
  })

  test('maps user_message type same as user', () => {
    const result = toClientPayload(
      makeEvent({ type: 'user_message', sessionId: 'sess-2', payload: { content: 'world' } }),
    )
    expect(result.type).toBe('user')
    expect(result.session_id).toBe('sess-2')
  })

  test('falls back to message field when content is missing', () => {
    const result = toClientPayload(
      makeEvent({ type: 'user', sessionId: 'sess-3', payload: { message: 'fallback msg' } }),
    )
    expect((result as { message: { content: string } }).message.content).toBe('fallback msg')
  })

  test('falls back to empty string when both content and message missing', () => {
    const result = toClientPayload(makeEvent({ type: 'user', sessionId: 'sess-4', payload: {} }))
    expect((result as { message: { content: string } }).message.content).toBe('')
  })

  test('includes isSynthetic when true', () => {
    const result = toClientPayload(
      makeEvent({ type: 'user', sessionId: 'sess-5', payload: { content: 'auto', isSynthetic: true } }),
    )
    expect((result as { isSynthetic?: boolean }).isSynthetic).toBe(true)
  })

  test('does not include isSynthetic when false', () => {
    const result = toClientPayload(
      makeEvent({ type: 'user', sessionId: 'sess-6', payload: { content: 'manual', isSynthetic: false } }),
    )
    expect((result as { isSynthetic?: boolean }).isSynthetic).toBeUndefined()
  })

  test('uses payload.uuid when present', () => {
    const result = toClientPayload(
      makeEvent({ type: 'user', sessionId: 'sess-7', payload: { content: 'hi', uuid: 'custom-uuid' } }),
    )
    expect(result.uuid).toBe('custom-uuid')
  })

  test('falls back to event.id when payload.uuid is missing', () => {
    const result = toClientPayload(makeEvent({ type: 'user', sessionId: 'sess-8', payload: { content: 'hi' } }))
    expect(result.uuid).toBe('evt-1')
  })
})

// =============================================================================
// permission_response / control_response
// =============================================================================

describe('toClientPayload — permission response', () => {
  test('approved=true maps to allow behavior', () => {
    const result = toClientPayload(
      makeEvent({ type: 'permission_response', sessionId: 'sess-1', payload: { approved: true, request_id: 'req-1' } }),
    )
    expect(result.type).toBe('control_response')
    const response = (result as { response: Record<string, unknown> }).response
    expect(response.subtype).toBe('success')
    expect(response.request_id).toBe('req-1')
    expect((response.response as { behavior: string }).behavior).toBe('allow')
  })

  test('approved=true without updated_input still sends an empty updatedInput record', () => {
    // The CLI's permission result schema requires `updatedInput` on allow; an empty
    // object means "use the original tool input" (see PermissionPromptToolResultSchema).
    const result = toClientPayload(
      makeEvent({
        type: 'permission_response',
        sessionId: 'sess-1b',
        payload: { approved: true, request_id: 'req-1b' },
      }),
    )
    const response = (result as { response: { response: Record<string, unknown> } }).response
    expect(response.response.updatedInput).toEqual({})
  })

  test('approved=false maps to deny behavior with error', () => {
    const result = toClientPayload(
      makeEvent({
        type: 'permission_response',
        sessionId: 'sess-2',
        payload: { approved: false, request_id: 'req-2' },
      }),
    )
    const response = (result as { response: Record<string, unknown> }).response
    expect(response.subtype).toBe('error')
    expect(response.error).toBe('Permission denied by user')
    expect((response.response as { behavior: string }).behavior).toBe('deny')
  })

  test('approved=false includes feedback message when provided', () => {
    const result = toClientPayload(
      makeEvent({
        type: 'permission_response',
        sessionId: 'sess-3',
        payload: { approved: false, request_id: 'req-3', message: 'please revise' },
      }),
    )
    expect((result as { response: Record<string, unknown> }).response.message).toBe('please revise')
  })

  test('passes through existingResponse directly', () => {
    const existingResponse = { subtype: 'success', custom: true }
    const result = toClientPayload(
      makeEvent({
        type: 'control_response',
        sessionId: 'sess-4',
        payload: { approved: true, response: existingResponse },
      }),
    )
    expect((result as { response: unknown }).response).toBe(existingResponse)
  })

  test('includes updatedInput when approved with updated_input', () => {
    const updatedInput = { file_path: '/new/path' }
    const result = toClientPayload(
      makeEvent({
        type: 'permission_response',
        sessionId: 'sess-5',
        payload: { approved: true, request_id: 'req-5', updated_input: updatedInput },
      }),
    )
    const response = (result as { response: { response: { updatedInput: unknown } } }).response
    expect(response.response.updatedInput).toEqual(updatedInput)
  })

  test('includes updatedPermissions when approved with updated_permissions', () => {
    const permissions = [{ type: 'allow', tool: 'bash' }]
    const result = toClientPayload(
      makeEvent({
        type: 'permission_response',
        sessionId: 'sess-6',
        payload: { approved: true, request_id: 'req-6', updated_permissions: permissions },
      }),
    )
    const response = (result as { response: { response: { updatedPermissions: unknown } } }).response
    expect(response.response.updatedPermissions).toEqual(permissions)
  })
})

// =============================================================================
// interrupt
// =============================================================================

describe('toClientPayload — interrupt', () => {
  test('maps interrupt to control_request with subtype interrupt', () => {
    const result = toClientPayload(makeEvent({ type: 'interrupt', sessionId: 'sess-1' }))
    expect(result.type).toBe('control_request')
    expect((result as { request_id: string }).request_id).toBe('evt-1')
    expect((result as { request: { subtype: string } }).request.subtype).toBe('interrupt')
  })
})

// =============================================================================
// control_request
// =============================================================================

describe('toClientPayload — control_request', () => {
  test('passes through request_id and request from payload', () => {
    const result = toClientPayload(
      makeEvent({
        type: 'control_request',
        sessionId: 'sess-1',
        payload: { request_id: 'req-99', request: { subtype: 'permission', tool: 'bash' } },
      }),
    )
    expect(result.type).toBe('control_request')
    expect((result as { request_id: string }).request_id).toBe('req-99')
    expect((result as { request: { subtype: string } }).request.subtype).toBe('permission')
  })

  test('falls back request to payload when no request field', () => {
    const result = toClientPayload(
      makeEvent({ type: 'control_request', sessionId: 'sess-2', payload: { request_id: 'req-10', custom: 'data' } }),
    )
    expect((result as { request: unknown }).request).toEqual({ request_id: 'req-10', custom: 'data' })
  })

  test('falls back request_id to event.id when missing', () => {
    const result = toClientPayload(
      makeEvent({ type: 'control_request', sessionId: 'sess-3', payload: { request: { subtype: 'test' } } }),
    )
    expect((result as { request_id: string }).request_id).toBe('evt-1')
  })
})

// =============================================================================
// assistant message
// =============================================================================

describe('toClientPayload — assistant message', () => {
  test('restores the wire message from the normalized payload', () => {
    const wire = { role: 'assistant', content: [{ type: 'text', text: 'response text' }] }
    const result = toClientPayload(
      makeEvent({
        type: 'assistant',
        sessionId: 'sess-1',
        payload: { uuid: 'u-1', content: 'response text', raw: { message: wire, uuid: 'u-1' }, message: wire },
      }),
    )
    expect(result.type).toBe('assistant')
    expect(result.uuid).toBe('u-1')
    expect(result.session_id).toBe('sess-1')
    expect((result as { message: unknown }).message).toEqual(wire)
  })

  test('unwraps projections nested by replayed echoes', () => {
    const wire = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
    // Each reconnect persisted the previous projection as `message`, so the chain
    // grows one level per cycle; the oldest projection still holds the wire message.
    const result = toClientPayload(
      makeEvent({
        type: 'assistant',
        sessionId: 'sess-2',
        payload: { content: 'hi', message: { content: 'hi', message: wire } },
      }),
    )
    expect((result as { message: unknown }).message).toEqual(wire)
  })

  test('falls back to a text block when no wire message survived', () => {
    const result = toClientPayload(
      makeEvent({ type: 'assistant', sessionId: 'sess-3', payload: { uuid: 'u-1', content: 'response text' } }),
    )
    expect((result as { message: unknown }).message).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'response text' }],
    })
  })
})

// =============================================================================
// user wire message blocks
// =============================================================================

describe('toClientPayload — user wire message', () => {
  test('preserves block content such as tool results', () => {
    const wire = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }],
    }
    const result = toClientPayload(
      makeEvent({
        type: 'user',
        sessionId: 'sess-1',
        payload: { uuid: 'u-9', content: 'ok', message: wire },
      }),
    )
    expect((result as { message: unknown }).message).toEqual(wire)
  })
})

// =============================================================================
// default fallback
// =============================================================================

describe('toClientPayload — default types', () => {
  test('passes through unknown type with type/uuid/session_id/message', () => {
    const payload = { uuid: 'u-1', content: 'result text' }
    const result = toClientPayload(makeEvent({ type: 'result', sessionId: 'sess-1', payload }))
    expect(result.type).toBe('result')
    expect(result.uuid).toBe('u-1')
    expect(result.session_id).toBe('sess-1')
    expect(result.message).toEqual(payload)
  })
})
