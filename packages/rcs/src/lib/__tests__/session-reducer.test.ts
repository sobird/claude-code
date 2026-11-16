import { describe, expect, test } from 'bun:test'

import {
  applyHistory,
  initialChatState,
  reduceSessionEvent,
  type AssistantMessageEntry,
  type ChatState,
  type SessionEventInput,
  type ToolCallEntry,
} from '../session-reducer'

let nextSeqNum = 1

function event(type: string, payload: unknown, overrides: Partial<SessionEventInput> = {}): SessionEventInput {
  return {
    id: `evt-${nextSeqNum}`,
    seqNum: nextSeqNum++,
    type,
    payload,
    direction: 'inbound',
    ...overrides,
  }
}

function tools(state: ChatState): ToolCallEntry[] {
  return state.entries.filter((entry): entry is ToolCallEntry => entry.type === 'tool_call')
}

function assistants(state: ChatState): AssistantMessageEntry[] {
  return state.entries.filter((entry): entry is AssistantMessageEntry => entry.type === 'assistant_message')
}

describe('reduceSessionEvent', () => {
  test('assistant text appends across two events into one entry', () => {
    let state = initialChatState
    state = reduceSessionEvent(state, event('assistant', { content: 'Hello' }))
    state = reduceSessionEvent(state, event('assistant', { content: ' world' }))

    expect(state.entries).toHaveLength(1)
    const [message] = assistants(state)
    expect(message?.chunks).toEqual([{ type: 'message', text: 'Hello world' }])
  })

  test('tool_use creates a running tool call', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read', tool_input: { file: 'a.ts' } }),
    )

    const [call] = tools(state)
    expect(call?.toolCall).toMatchObject({ id: 'call-1', title: 'Read', status: 'running', rawInput: { file: 'a.ts' } })
  })

  test('tool_result attaches output and completes the matching call', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    state = reduceSessionEvent(state, event('tool_result', { tool_call_id: 'call-1', content: 'file body' }))

    const [call] = tools(state)
    expect(call?.toolCall.status).toBe('complete')
    expect(call?.toolCall.rawOutput).toEqual({ output: 'file body' })
  })

  test('tool_result with is_error marks the call as errored', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(state, event('tool_result', { tool_call_id: 'call-1', content: 'boom', is_error: true }))

    expect(tools(state)[0]?.toolCall.status).toBe('error')
  })

  test('control_request creates a pending permission and marks the call waiting', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('control_request', {
        request_id: 'req-1',
        request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, description: 'Run ls' },
      }),
    )

    expect(state.pendingPermissions).toEqual([
      { requestId: 'req-1', toolName: 'Bash', toolInput: { command: 'ls' }, description: 'Run ls' },
    ])
    expect(tools(state)[0]?.toolCall.status).toBe('waiting_for_confirmation')
    expect(tools(state)[0]?.toolCall.permissionRequest?.requestId).toBe('req-1')
  })

  test('control_request without a running call creates a standalone permission card', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'req-2',
        request: { subtype: 'can_use_tool', tool_name: 'Write', input: { path: 'x' } },
      }),
    )

    expect(tools(state)[0]?.toolCall.isStandalonePermission).toBe(true)
    expect(state.pendingPermissions).toHaveLength(1)
  })

  test('approved control_response resumes the call and clears the pending permission', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }),
    )
    state = reduceSessionEvent(state, event('permission_response', { request_id: 'req-1', approved: true }))

    expect(state.pendingPermissions).toHaveLength(0)
    expect(tools(state)[0]?.toolCall.status).toBe('running')
    expect(tools(state)[0]?.toolCall.permissionRequest).toBeUndefined()
  })

  test('rejected control_response retains the call as rejected and clears the pending permission', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }),
    )
    state = reduceSessionEvent(state, event('control_response', { request_id: 'req-1', approved: false }))

    expect(state.pendingPermissions).toHaveLength(0)
    expect(tools(state)[0]?.toolCall.status).toBe('rejected')
  })

  test('control_response resolves a nested response.request_id shape', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'req-9', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }),
    )
    state = reduceSessionEvent(state, event('control_response', { response: { request_id: 'req-9' }, approved: true }))

    expect(state.pendingPermissions).toHaveLength(0)
    expect(tools(state)[0]?.toolCall.status).toBe('running')
  })

  test('session_status archived marks the session closed', () => {
    const state = reduceSessionEvent(initialChatState, event('session_status', { status: 'archived' }))

    expect(state.status).toBe('archived')
    expect(state.closed).toBe(true)
  })

  test('session_status inactive marks the session closed', () => {
    const state = reduceSessionEvent(initialChatState, event('session_status', { status: 'inactive' }))
    expect(state.closed).toBe(true)
  })

  test('duplicate seqNum events are ignored and return the same state', () => {
    const first = event('assistant', { content: 'Hello' })
    const state = reduceSessionEvent(initialChatState, first)
    const duplicate = reduceSessionEvent(state, { ...first, payload: { content: ' ignored' } })

    expect(duplicate).toBe(state)
    expect(assistants(duplicate)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
  })

  test('events without seqNum dedupe by id', () => {
    const first = event('assistant', { content: 'Hello' }, { seqNum: undefined })
    const state = reduceSessionEvent(initialChatState, first)
    const duplicate = reduceSessionEvent(state, first)
    expect(duplicate).toBe(state)
  })

  test('outbound user echoes are skipped', () => {
    const state = reduceSessionEvent(initialChatState, event('user', { content: 'hi' }, { direction: 'outbound' }))
    expect(state.entries).toHaveLength(0)
  })

  test('inbound user messages become entries', () => {
    const state = reduceSessionEvent(initialChatState, event('user', { content: 'hi' }))
    expect(state.entries).toEqual([{ type: 'user_message', id: expect.any(String), content: 'hi' }])
  })

  test('embedded tool_use blocks in an assistant message create running calls', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        message: {
          content: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'a.ts' } },
          ],
        },
      }),
    )

    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'Checking.' }])
    const [call] = tools(state)
    expect(call?.toolCall).toMatchObject({ id: 'tool-1', title: 'Read', status: 'running' })
  })
})

describe('applyHistory', () => {
  test('history followed by a live duplicate of the same seqNum does not double-apply', () => {
    const a = event('assistant', { content: 'Hel' })
    const b = event('assistant', { content: 'lo' })

    let state = applyHistory(initialChatState, [a, b])
    state = reduceSessionEvent(state, b)

    expect(state.entries).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
  })

  test('folds events in order', () => {
    const events = [event('user', { content: 'question' }), event('assistant', { content: 'answer' })]
    const state = applyHistory(initialChatState, events)
    expect(state.entries.map((entry) => entry.type)).toEqual(['user_message', 'assistant_message'])
  })
})

describe('immutability', () => {
  test('does not mutate the previous state', () => {
    const before = reduceSessionEvent(initialChatState, event('assistant', { content: 'Hello' }))
    const snapshotEntries = before.entries
    const snapshotChunks = assistants(before)[0]?.chunks
    const snapshotSeen = new Set(before.seenSeqNums)

    const after = reduceSessionEvent(before, event('assistant', { content: ' world' }))

    expect(after).not.toBe(before)
    expect(before.entries).toBe(snapshotEntries)
    expect(assistants(before)[0]?.chunks).toBe(snapshotChunks)
    expect(assistants(before)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
    expect(before.seenSeqNums).toEqual(snapshotSeen)
    expect(after.seenSeqNums.size).toBe(snapshotSeen.size + 1)
  })
})
