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

  test('a replayed assistant message (same uuid, new seqNum) is not rendered twice', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', { uuid: 'msg-a', content: 'pong', message: { id: 'm1' } }),
    )
    state = reduceSessionEvent(state, event('user', { content: 'next turn' }))
    // The bridge replays history into the CLI on reconnect; the CLI echoes it.
    state = reduceSessionEvent(state, event('assistant', { uuid: 'msg-a', content: 'pong', message: { id: 'm1' } }))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'pong' }])
  })

  test('replay acknowledgments of a user message are ignored', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'hello', uuid: 'user-1' }))
    state = reduceSessionEvent(state, event('user', { content: 'hello', uuid: 'user-1', isReplay: true }))

    expect(state.entries.filter((entry) => entry.type === 'user_message')).toHaveLength(1)
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

  test('tool_result with a missing tool_call_id falls back to the most recent running call', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    state = reduceSessionEvent(state, event('tool_use', { tool_call_id: 'call-2', tool_name: 'Bash' }))
    state = reduceSessionEvent(state, event('tool_result', { content: 'done' }))

    const calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'call-2')?.toolCall.status).toBe('complete')
    expect(calls.find((call) => call.toolCall.id === 'call-1')?.toolCall.status).toBe('running')
  })

  test('tool_result with an unmatched tool_call_id is a no-op', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    const before = state
    state = reduceSessionEvent(state, event('tool_result', { tool_call_id: 'call-other', content: 'done' }))

    expect(state.entries).toBe(before.entries)
    expect(tools(state)[0]?.toolCall.status).toBe('running')
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

  test('control_request binds to the most recent running call with the matching title', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    state = reduceSessionEvent(state, event('tool_use', { tool_call_id: 'call-2', tool_name: 'Bash' }))
    state = reduceSessionEvent(state, event('tool_use', { tool_call_id: 'call-3', tool_name: 'Read' }))
    state = reduceSessionEvent(
      state,
      event('permission_request', { request_id: 'req-1', request: { tool_name: 'Read' } }),
    )

    const calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'call-3')?.toolCall.status).toBe('waiting_for_confirmation')
    expect(calls.find((call) => call.toolCall.id === 'call-3')?.toolCall.permissionRequest?.requestId).toBe('req-1')
    expect(calls.find((call) => call.toolCall.id === 'call-2')?.toolCall.status).toBe('running')
    expect(calls.find((call) => call.toolCall.id === 'call-1')?.toolCall.status).toBe('running')
  })

  test('control_request falls back to the most recent running call when no title matches', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    state = reduceSessionEvent(state, event('tool_use', { tool_call_id: 'call-2', tool_name: 'Bash' }))
    state = reduceSessionEvent(state, event('control_request', { request_id: 'req-1', request: { tool_name: 'Grep' } }))

    const calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'call-2')?.toolCall.status).toBe('waiting_for_confirmation')
    expect(calls.find((call) => call.toolCall.id === 'call-1')?.toolCall.status).toBe('running')
  })

  test('control_request does not rebind a call already awaiting a different request', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(state, event('control_request', { request_id: 'req-1', request: { tool_name: 'Bash' } }))
    state = reduceSessionEvent(state, event('control_request', { request_id: 'req-2', request: { tool_name: 'Bash' } }))

    const calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'call-1')?.toolCall.permissionRequest?.requestId).toBe('req-1')
    // The second request has no running call to bind to, so it becomes standalone.
    const standalone = calls.find((call) => call.toolCall.id === 'permission-req-2')
    expect(standalone?.toolCall.isStandalonePermission).toBe(true)
    expect(state.pendingPermissions.map((permission) => permission.requestId)).toEqual(['req-1', 'req-2'])
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

  test('approved standalone permission settles to complete', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', { request_id: 'req-2', request: { tool_name: 'Write' } }),
    )
    state = reduceSessionEvent(state, event('permission_response', { request_id: 'req-2', approved: true }))

    expect(tools(state)[0]?.toolCall.status).toBe('complete')
    expect(tools(state)[0]?.toolCall.isStandalonePermission).toBeUndefined()
    expect(state.pendingPermissions).toHaveLength(0)
  })

  test('rejected standalone permission settles to rejected', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', { request_id: 'req-2', request: { tool_name: 'Write' } }),
    )
    state = reduceSessionEvent(state, event('permission_response', { request_id: 'req-2', approved: false }))

    expect(tools(state)[0]?.toolCall.status).toBe('rejected')
    expect(state.pendingPermissions).toHaveLength(0)
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

  test('outbound user events become entries (sent messages survive reload)', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('user', { content: 'hi', uuid: 'uuid-1' }, { direction: 'outbound' }),
    )
    expect(state.entries).toEqual([{ type: 'user_message', id: 'uuid-1', content: 'hi' }])
  })

  test('inbound user messages become entries', () => {
    const state = reduceSessionEvent(initialChatState, event('user', { content: 'hi' }))
    expect(state.entries).toEqual([{ type: 'user_message', id: expect.any(String), content: 'hi' }])
  })

  test('user entry id prefers payload.uuid and falls back to seqNum', () => {
    const withUuid = reduceSessionEvent(initialChatState, event('user', { content: 'a', uuid: 'uuid-a' }))
    expect((withUuid.entries[0] as { id: string }).id).toBe('uuid-a')

    const withoutUuid = reduceSessionEvent(initialChatState, event('user', { content: 'b' }, { seqNum: 42 }))
    expect((withoutUuid.entries[0] as { id: string }).id).toBe('42')
  })

  test('folding the same uuid twice (optimistic + echo) yields one entry', () => {
    // Optimistic local event has no seqNum; the live echo has a different seqNum
    // but the same uuid.
    const local: SessionEventInput = {
      id: 'uuid-1',
      type: 'user',
      direction: 'outbound',
      payload: { content: 'hi', uuid: 'uuid-1' },
    }
    const echo: SessionEventInput = {
      id: 'evt-echo',
      seqNum: 7,
      type: 'user',
      direction: 'outbound',
      payload: { content: 'hi', uuid: 'uuid-1' },
    }

    let state = reduceSessionEvent(initialChatState, local)
    state = reduceSessionEvent(state, echo)

    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toEqual({ type: 'user_message', id: 'uuid-1', content: 'hi' })
  })

  test('replaying a user event with an already-present uuid does not mutate entries', () => {
    const first = event('user', { content: 'hi', uuid: 'uuid-1' }, { direction: 'outbound' })
    const state = reduceSessionEvent(initialChatState, first)
    const entriesBefore = state.entries
    const replay = reduceSessionEvent(state, { ...first, seqNum: undefined, id: 'other' })
    expect(replay.entries).toBe(entriesBefore)
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

  test('reload-equivalent history with an outbound user event shows the sent text', () => {
    const events = [
      event('user', { content: 'hello there', uuid: 'sent-1' }, { direction: 'outbound' }),
      event('assistant', { content: 'Hi!' }),
    ]
    const state = applyHistory(initialChatState, events)

    expect(state.entries).toEqual([
      { type: 'user_message', id: 'sent-1', content: 'hello there' },
      { type: 'assistant_message', id: expect.any(String), chunks: [{ type: 'message', text: 'Hi!' }] },
    ])
  })
})

test('missing tool names are left empty for the UI to localize', () => {
  const state = reduceSessionEvent(
    initialChatState,
    event('assistant', { content: [{ type: 'tool_use', id: 't1', input: {} }] }),
  )
  const call = state.entries.find((entry) => entry.type === 'tool_call')
  expect(call?.type === 'tool_call' ? call.toolCall.title : 'x').toBe('')
})

test('a permission request without a tool name is left empty', () => {
  const state = reduceSessionEvent(
    initialChatState,
    event('control_request', { request_id: 'r1', request: { subtype: 'can_use_tool', input: {} } }),
  )
  expect(state.pendingPermissions[0]?.toolName).toBe('')
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
