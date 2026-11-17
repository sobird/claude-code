import { describe, expect, test } from 'bun:test'

import {
  activeStreamEvents,
  applyHistory,
  initialChatState,
  isEphemeralEvent,
  reduceSessionEvent,
  type AssistantMessageEntry,
  type ChatState,
  type SessionEventInput,
  type ToolCallEntry,
  type TurnEndEntry,
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

  test('tool_result blocks inside a user message complete the matching call', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
    )
    // The CLI reports tool results as a synthetic user turn with tool_result blocks.
    state = reduceSessionEvent(
      state,
      event('user', {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt\nb.txt' }],
        },
      }),
    )

    const [call] = tools(state)
    expect(call?.toolCall.status).toBe('complete')
    expect(call?.toolCall.rawOutput).toEqual({ output: 'a.txt\nb.txt' })
    // A tool-result turn is not a user message bubble.
    expect(state.entries.filter((entry) => entry.type === 'user_message')).toHaveLength(0)
  })

  test('multiple tool_result blocks settle every call and join text blocks', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
            { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} },
          ],
        },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('user', {
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'part one ' },
                { type: 'image', source: {} },
                { type: 'text', text: 'part two' },
              ],
            },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'denied', is_error: true },
          ],
        },
      }),
    )

    const calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'toolu_1')?.toolCall).toMatchObject({
      status: 'complete',
      rawOutput: { output: 'part one part two' },
    })
    expect(calls.find((call) => call.toolCall.id === 'toolu_2')?.toolCall.status).toBe('error')
  })

  test('a user turn with text and tool_result renders the bubble and settles the call', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('user', {
        content: 'look at this',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'ok' },
          ],
        },
      }),
    )

    expect(tools(state)[0]?.toolCall.status).toBe('complete')
    expect(state.entries.filter((entry) => entry.type === 'user_message')).toHaveLength(1)
  })

  test('a tool_result for an unknown call is ignored', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    const before = tools(state)[0]?.toolCall
    state = reduceSessionEvent(
      state,
      event('user', {
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-other', content: 'x' }] },
      }),
    )

    expect(tools(state)[0]?.toolCall).toEqual(before)
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
      {
        requestId: 'req-1',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        description: 'Run ls',
        suggestions: [],
      },
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

  test('control_request keeps permission suggestions and request context', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'npm run build' },
          tool_use_id: 'toolu_1',
          blocked_path: '/repo/node_modules',
          permission_suggestions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ],
        },
      }),
    )

    expect(state.pendingPermissions[0]).toMatchObject({
      requestId: 'req-1',
      toolUseId: 'toolu_1',
      blockedPath: '/repo/node_modules',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    })
  })

  test('a replayed control_request does not overwrite the pending suggestion list', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'req-1',
        request: { tool_name: 'Bash', permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] },
      }),
    )
    state = reduceSessionEvent(state, event('control_request', { request_id: 'req-1', request: { tool_name: 'Bash' } }))

    expect(state.pendingPermissions).toHaveLength(1)
    expect(state.pendingPermissions[0]?.suggestions).toEqual([{ type: 'setMode', mode: 'acceptEdits' }])
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

  test('control_cancel_request clears the card and resumes a bound tool call', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Bash' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }),
    )
    state = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'req-1' }))

    expect(state.pendingPermissions).toHaveLength(0)
    // The CLI resolved the request locally, so the call keeps going.
    expect(tools(state)[0]?.toolCall.status).toBe('running')
    expect(tools(state)[0]?.toolCall.permissionRequest).toBeUndefined()
  })

  test('control_cancel_request removes a standalone permission card', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'req-1',
        request: { subtype: 'can_use_tool', tool_name: 'Bash' },
      }),
    )
    expect(state.pendingPermissions).toHaveLength(1)
    expect(tools(state)).toHaveLength(1)

    state = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'req-1' }))

    expect(state.pendingPermissions).toHaveLength(0)
    // A standalone card has no call behind it and will never settle; drop it.
    expect(tools(state)).toHaveLength(0)
  })

  test('control_cancel_request clears a matching pending mode switch', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', permissionMode: 'default' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mode-1', request: { subtype: 'set_permission_mode', mode: 'plan' } }),
    )
    expect(state.pendingMode).not.toBeNull()

    state = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'mode-1' }))

    expect(state.pendingMode).toBeNull()
    expect(state.permissionMode).toBe('default')
    expect(state.modeError).toBeNull()
  })

  test('control_cancel_request for another request leaves state untouched', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('control_request', { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }),
    )
    const next = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'other' }))

    expect(next.pendingPermissions).toBe(state.pendingPermissions)
    expect(next.entries).toBe(state.entries)
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

  test('session_status inactive is resumable, not closed', () => {
    const state = reduceSessionEvent(initialChatState, event('session_status', { status: 'inactive' }))
    expect(state.status).toBe('inactive')
    expect(state.closed).toBe(false)
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

  test('user entries carry stored image references alongside the text', () => {
    const blocks = [
      { type: 'image', source: { type: 'attachment', attachment_id: 'att_1', media_type: 'image/png' } },
      { type: 'text', text: 'look at this' },
    ]
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'user',
        { uuid: 'uuid-img', content: blocks, message: { role: 'user', content: blocks } },
        { direction: 'outbound' },
      ),
    )
    expect(state.entries).toEqual([
      {
        type: 'user_message',
        id: 'uuid-img',
        content: 'look at this',
        attachments: [{ id: 'att_1', mediaType: 'image/png' }],
      },
    ])
  })

  test('image-only user messages still become entries', () => {
    const blocks = [{ type: 'image', source: { type: 'attachment', attachment_id: 'att_2', media_type: 'image/jpeg' } }]
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'user',
        { uuid: 'uuid-only-img', content: blocks, message: { role: 'user', content: blocks } },
        { direction: 'outbound' },
      ),
    )
    expect(state.entries).toEqual([
      {
        type: 'user_message',
        id: 'uuid-only-img',
        content: '',
        attachments: [{ id: 'att_2', mediaType: 'image/jpeg' }],
      },
    ])
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

  test('system init records slash commands and the permission mode', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', slash_commands: ['compact', 'clear'], permissionMode: 'plan' }),
    )

    expect(state.slashCommands).toEqual(['compact', 'clear'])
    expect(state.permissionMode).toBe('plan')
  })

  test('system init ignores unsupported permission modes but keeps the old one', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', slash_commands: ['compact'], permissionMode: 'plan' }),
    )
    state = reduceSessionEvent(state, event('system', { subtype: 'init', permissionMode: 'auto' }))

    expect(state.permissionMode).toBe('plan')
  })

  test('repeated system init overwrites commands and filters junk entries', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', slash_commands: ['compact', 1, null, 'compact', 'clear'] }),
    )
    state = reduceSessionEvent(state, event('system', { subtype: 'init', slash_commands: ['cost'] }))

    expect(state.slashCommands).toEqual(['cost'])
  })

  test('non-init system events are ignored', () => {
    const state = reduceSessionEvent(initialChatState, event('system', { subtype: 'other', permissionMode: 'plan' }))
    expect(state.permissionMode).toBeNull()
    expect(state.slashCommands).toEqual([])
  })

  test('system status adopts the CLI-reported permission mode', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', slash_commands: ['compact'], permissionMode: 'plan' }),
    )
    state = reduceSessionEvent(state, event('system', { subtype: 'status', permissionMode: 'acceptEdits' }))

    expect(state.permissionMode).toBe('acceptEdits')
    // Status never carries commands, so the init snapshot must survive.
    expect(state.slashCommands).toEqual(['compact'])
  })

  test('system status ignores unsupported permission modes', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', permissionMode: 'plan' }))
    state = reduceSessionEvent(state, event('system', { subtype: 'status', permissionMode: 'auto' }))

    expect(state.permissionMode).toBe('plan')
  })

  test('an outbound set_permission_mode request starts a pending mode change', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'control_request',
        { type: 'control_request', request_id: 'mode-1', request: { subtype: 'set_permission_mode', mode: 'plan' } },
        { direction: 'outbound' },
      ),
    )

    expect(state.pendingMode).toEqual({ requestId: 'mode-1', mode: 'plan' })
    expect(state.entries).toHaveLength(0)
    expect(state.pendingPermissions).toHaveLength(0)
  })

  test('a successful mode control_response adopts the requested mode', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', permissionMode: 'default' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mode-1', request: { subtype: 'set_permission_mode', mode: 'plan' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mode-1', subtype: 'success' } }),
    )

    expect(state.permissionMode).toBe('plan')
    expect(state.pendingMode).toBeNull()
    expect(state.modeError).toBeNull()
  })

  test('an error mode control_response keeps the mode and records the error', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', permissionMode: 'default' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mode-1', request: { subtype: 'set_permission_mode', mode: 'plan' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', {
        response: { request_id: 'mode-1', subtype: 'error', error: 'bypass disabled' },
      }),
    )

    expect(state.permissionMode).toBe('default')
    expect(state.pendingMode).toBeNull()
    expect(state.modeError).toBe('bypass disabled')
  })

  test('an unrelated control_response leaves the mode state untouched', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', permissionMode: 'default' }))
    state = reduceSessionEvent(state, event('permission_response', { request_id: 'other', approved: true }))

    expect(state.permissionMode).toBe('default')
    expect(state.modeError).toBeNull()
  })
})

describe('model state', () => {
  test('system init records the model', () => {
    const state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'claude-sonnet-4-6' }))
    expect(state.model).toBe('claude-sonnet-4-6')
  })

  test('system init ignores an invalid model but keeps the previous one', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'claude-opus-4-6' }))
    state = reduceSessionEvent(state, event('system', { subtype: 'init', model: 42 }))
    expect(state.model).toBe('claude-opus-4-6')

    state = reduceSessionEvent(state, event('system', { subtype: 'init', model: '  ' }))
    expect(state.model).toBe('claude-opus-4-6')
  })

  test('an outbound set_model request starts a pending model change', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'control_request',
        { type: 'control_request', request_id: 'mdl-1', request: { subtype: 'set_model', model: 'opus' } },
        { direction: 'outbound' },
      ),
    )

    expect(state.pendingModel).toEqual({ requestId: 'mdl-1', model: 'opus' })
    expect(state.entries).toHaveLength(0)
    expect(state.pendingPermissions).toHaveLength(0)
  })

  test('an outbound set_model without a model tracks a default reset', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model' } }, { direction: 'outbound' }),
    )
    expect(state.pendingModel).toEqual({ requestId: 'mdl-1', model: null })
  })

  test('a successful model control_response adopts the requested value', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'sonnet' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model', model: 'opus' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mdl-1', subtype: 'success' } }),
    )

    expect(state.model).toBe('opus')
    expect(state.pendingModel).toBeNull()
    expect(state.modelError).toBeNull()
  })

  test('a successful default reset clears the model', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'sonnet' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mdl-1', subtype: 'success' } }),
    )

    expect(state.model).toBeNull()
  })

  test('an error model control_response keeps the model and records the error', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'sonnet' }))
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model', model: 'nope' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mdl-1', subtype: 'error', error: 'Unknown model' } }),
    )

    expect(state.model).toBe('sonnet')
    expect(state.pendingModel).toBeNull()
    expect(state.modelError).toBe('Unknown model')
  })

  test('mode and model settlements do not interfere', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', permissionMode: 'default', model: 'sonnet' }),
    )
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mode-1', request: { subtype: 'set_permission_mode', mode: 'plan' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mode-1', subtype: 'success' } }),
    )

    expect(state.permissionMode).toBe('plan')
    expect(state.model).toBe('sonnet')
    expect(state.pendingModel).toBeNull()
    expect(state.modelError).toBeNull()

    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model', model: 'opus' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'mdl-1', subtype: 'success' } }),
    )

    expect(state.permissionMode).toBe('plan')
    expect(state.model).toBe('opus')
    expect(state.pendingMode).toBeNull()
    expect(state.modeError).toBeNull()
  })

  test('control_cancel_request clears a matching pending model change', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', { request_id: 'mdl-1', request: { subtype: 'set_model', model: 'opus' } }),
    )
    state = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'mdl-1' }))

    expect(state.pendingModel).toBeNull()
    expect(state.modelError).toBeNull()
  })

  test('an unrelated control_response leaves the model state untouched', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', model: 'sonnet' }))
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'other', subtype: 'success' } }),
    )

    expect(state.model).toBe('sonnet')
    expect(state.modelError).toBeNull()
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

// Streaming frames are live-only: the bridge marks them `ephemeral` and the SSE
// frame omits `id:`. The payload is the raw SDK stream event under `event`.
function streamEvent(inner: Record<string, unknown>, overrides: Partial<SessionEventInput> = {}): SessionEventInput {
  return event('stream_event', { type: 'stream_event', event: inner }, { ephemeral: true, ...overrides })
}

// The gateway's `normalizePayload` wraps every inbound message as
// `{ content, raw }` before publishing it, so the live SSE stream nests the SDK
// stream event under `raw.event` — not at the top level like `streamEvent` above.
function normalizedStreamEvent(inner: Record<string, unknown>, overrides: Partial<SessionEventInput> = {}) {
  return event(
    'stream_event',
    { content: '', raw: { type: 'stream_event', uuid: 'stream-uuid', event: inner } },
    { ephemeral: true, ...overrides },
  )
}

function textDelta(text: string): Record<string, unknown> {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
}

function thinkingDelta(thinking: string): Record<string, unknown> {
  return { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }
}

describe('streaming deltas', () => {
  test('text deltas accumulate into one transient assistant entry', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent({ type: 'message_start' }))
    state = reduceSessionEvent(state, streamEvent(textDelta('Hel')))
    state = reduceSessionEvent(state, streamEvent(textDelta('lo')))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
    expect(assistants(state)[0]?.streaming).toBe(true)
  })

  test('gateway-normalized payloads (event nested under raw) stream like raw ones', () => {
    let state = reduceSessionEvent(initialChatState, normalizedStreamEvent({ type: 'message_start' }))
    state = reduceSessionEvent(state, normalizedStreamEvent(textDelta('Hel')))
    state = reduceSessionEvent(state, normalizedStreamEvent(textDelta('lo')))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
    expect(assistants(state)[0]?.streaming).toBe(true)
  })

  test('thinking deltas become a thought chunk', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(thinkingDelta('pondering')))
    state = reduceSessionEvent(state, streamEvent(textDelta('answer')))

    expect(assistants(state)[0]?.chunks).toEqual([
      { type: 'thought', text: 'pondering' },
      { type: 'message', text: 'answer' },
    ])
  })

  test('message_start resets the transient entry instead of merging messages', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('first')))
    state = reduceSessionEvent(state, streamEvent({ type: 'message_start' }))
    state = reduceSessionEvent(state, streamEvent(textDelta('second')))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'second' }])
  })

  test('the complete assistant message replaces the streamed prefix without duplication', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('Hel')))
    state = reduceSessionEvent(state, streamEvent(textDelta('lo')))
    state = reduceSessionEvent(state, event('assistant', { uuid: 'msg-1', content: 'Hello' }))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'Hello' }])
    expect(assistants(state)[0]?.streaming).toBeUndefined()
  })

  test('streaming frames are not deduped or tracked as durable sequence numbers', () => {
    const frame = streamEvent(textDelta('a'))
    const state = reduceSessionEvent(initialChatState, frame)

    expect(state.seenSeqNums.size).toBe(0)
    expect(state.lastSeqNum).toBe(0)
  })

  test('a failed result surfaces its message and drops the streaming entry', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('partial')))
    state = reduceSessionEvent(state, event('result', { subtype: 'error_during_execution', result: 'boom' }))

    expect(state.error).toBe('boom')
    expect(assistants(state)).toHaveLength(0)
  })

  test('a failed result without a message falls back to the subtype', () => {
    const state = reduceSessionEvent(initialChatState, event('result', { subtype: 'error_max_turns' }))
    expect(state.error).toBe('error_max_turns')
  })

  test('a successful result clears a prior error', () => {
    let state = reduceSessionEvent(initialChatState, event('error', { message: 'oops' }))
    expect(state.error).toBe('oops')
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }))

    expect(state.error).toBeNull()
  })

  test('a non-running session status drops the streaming entry', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('partial')))
    state = reduceSessionEvent(state, event('session_status', { status: 'idle' }))

    expect(assistants(state)).toHaveLength(0)
  })

  test('a new user message clears the prior error', () => {
    let state = reduceSessionEvent(initialChatState, event('error', { message: 'oops' }))
    state = reduceSessionEvent(state, event('user', { content: 'try again' }))

    expect(state.error).toBeNull()
  })
})

describe('activeStreamEvents', () => {
  test('keeps only the deltas that arrive after the last terminal durable event', () => {
    const frames: SessionEventInput[] = [
      streamEvent(textDelta('old'), { seqNum: 9_000_000_001 }),
      event('assistant', { content: 'done' }, { seqNum: 5 }),
      streamEvent(textDelta('new'), { seqNum: 9_000_000_002 }),
      streamEvent(textDelta('er'), { seqNum: 9_000_000_003 }),
    ]

    expect(activeStreamEvents(frames).map((frame) => frame.seqNum)).toEqual([9_000_000_002, 9_000_000_003])
  })

  test('returns an empty window when the turn already ended durably', () => {
    const frames: SessionEventInput[] = [
      streamEvent(textDelta('a'), { seqNum: 9_000_000_001 }),
      event('result', { subtype: 'success' }, { seqNum: 5 }),
    ]

    expect(activeStreamEvents(frames)).toEqual([])
  })

  test('keeps deltas that arrive before any terminal event', () => {
    const frames: SessionEventInput[] = [
      event('user', { content: 'hi' }, { seqNum: 1 }),
      streamEvent(textDelta('a'), { seqNum: 9_000_000_001 }),
    ]

    expect(activeStreamEvents(frames)).toHaveLength(1)
  })
})

test('isEphemeralEvent recognizes stream frames even without the transport flag', () => {
  expect(isEphemeralEvent({ type: 'stream_event' })).toBe(true)
  expect(isEphemeralEvent({ type: 'stream_event', ephemeral: false })).toBe(true)
  expect(isEphemeralEvent({ type: 'assistant', ephemeral: true })).toBe(true)
  expect(isEphemeralEvent({ type: 'assistant' })).toBe(false)
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

describe('turn duration', () => {
  function turnEnds(state: ChatState): TurnEndEntry[] {
    return state.entries.filter((entry): entry is TurnEndEntry => entry.type === 'turn_end')
  }

  test('a result closes the turn opened by the last user message', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'hello' }, { createdAt: 1_000 }))
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }, { createdAt: 3_500 }))

    expect(turnEnds(state)).toHaveLength(1)
    expect(turnEnds(state)[0]?.durationMs).toBe(2_500)
    expect(state.turnStartedAt).toBeNull()
  })

  test('a result without a preceding user message adds nothing', () => {
    const state = reduceSessionEvent(initialChatState, event('result', { subtype: 'success' }, { createdAt: 5_000 }))

    expect(turnEnds(state)).toHaveLength(0)
  })

  test('a replayed duplicate user event does not restart the clock', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('user', { content: 'hello', uuid: 'u-1' }, { createdAt: 1_000 }),
    )
    state = reduceSessionEvent(state, event('user', { content: 'hello', uuid: 'u-1' }, { createdAt: 2_000 }))
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }, { createdAt: 3_000 }))

    expect(turnEnds(state)[0]?.durationMs).toBe(2_000)
  })

  test('failed results still record the turn length', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'hello' }, { createdAt: 1_000 }))
    state = reduceSessionEvent(
      state,
      event('result', { subtype: 'error_during_execution', result: 'boom' }, { createdAt: 4_000 }),
    )

    expect(turnEnds(state)[0]?.durationMs).toBe(3_000)
    expect(state.error).toBe('boom')
  })

  test('live frames fall back to receivedAt when createdAt is absent', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'hello' }, { receivedAt: 10_000 }))
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }, { receivedAt: 12_000 }))

    expect(turnEnds(state)[0]?.durationMs).toBe(2_000)
  })
})

describe('session tasks', () => {
  function todoBlock(todos: unknown[]) {
    return { type: 'tool_use', id: 'tool-1', name: 'TodoWrite', input: { todos } }
  }

  test('a TodoWrite block in an assistant message replaces the task list', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        message: {
          content: [todoBlock([{ content: 'One', status: 'in_progress', activeForm: 'Doing one' }])],
        },
      }),
    )

    expect(state.tasks).toEqual([{ id: '0', content: 'One', status: 'in_progress', activeForm: 'Doing one' }])
  })

  test('a later TodoWrite replaces the previous list and an empty list clears it', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', { message: { content: [todoBlock([{ content: 'One', status: 'pending' }])] } }),
    )
    state = reduceSessionEvent(
      state,
      event('assistant', { message: { content: [todoBlock([{ content: 'Two', status: 'in_progress' }])] } }),
    )
    expect(state.tasks.map((task) => task.content)).toEqual(['Two'])

    state = reduceSessionEvent(state, event('assistant', { message: { content: [todoBlock([])] } }))
    expect(state.tasks).toEqual([])
  })

  test('other tools leave the task list alone', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', { message: { content: [todoBlock([{ content: 'One', status: 'pending' }])] } }),
    )
    state = reduceSessionEvent(
      state,
      event('assistant', {
        message: { content: [{ type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'ls' } }] },
      }),
    )

    expect(state.tasks.map((task) => task.content)).toEqual(['One'])
  })

  test('a standalone tool_use event for TodoWrite updates the list', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('tool_use', {
        tool_call_id: 'call-9',
        tool_name: 'TodoWrite',
        tool_input: { todos: [{ content: 'Standalone', status: 'completed' }] },
      }),
    )

    expect(state.tasks).toEqual([{ id: '0', content: 'Standalone', status: 'completed', activeForm: undefined }])
  })

  test('task_state events map onto the same list shape', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('task_state', { task_list_id: 'team', tasks: [{ id: 't1', subject: 'Investigate', status: 'pending' }] }),
    )

    expect(state.tasks).toEqual([{ id: 't1', content: 'Investigate', status: 'pending', activeForm: undefined }])
  })
})

describe('queued prompts', () => {
  function userEntry(state: ChatState) {
    const entry = state.entries.find((item) => item.type === 'user_message')
    return entry?.type === 'user_message' ? entry : undefined
  }

  test('a message sent while the agent is running is marked queued', () => {
    let state = reduceSessionEvent(initialChatState, event('session_status', { status: 'running' }))
    state = reduceSessionEvent(state, event('user', { content: 'next task', uuid: 'u1' }))

    expect(userEntry(state)?.queued).toBe(true)
  })

  test('a message sent while idle is not queued', () => {
    let state = reduceSessionEvent(initialChatState, event('session_status', { status: 'idle' }))
    state = reduceSessionEvent(state, event('user', { content: 'hello', uuid: 'u1' }))

    expect(userEntry(state)?.queued).toBeUndefined()
  })

  test('a message sent mid-turn is queued even without session_status events', () => {
    // The bridge does not always publish session_status; an open turn is the
    // signal that a new prompt lands in the CLI's queue.
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'start', uuid: 'u1' }))
    state = reduceSessionEvent(state, event('assistant', { content: 'working', uuid: 'a1' }))
    state = reduceSessionEvent(state, event('user', { content: 'next task', uuid: 'u2' }))

    const entries = state.entries.filter((entry) => entry.type === 'user_message')
    const second = entries[1]?.type === 'user_message' ? entries[1] : undefined
    expect(second?.content).toBe('next task')
    expect(second?.queued).toBe(true)
  })

  test('an idle session_status closes the queued window', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'start', uuid: 'u1' }))
    state = reduceSessionEvent(state, event('session_status', { status: 'idle' }))
    state = reduceSessionEvent(state, event('user', { content: 'again', uuid: 'u2' }))

    const entries = state.entries.filter((entry) => entry.type === 'user_message')
    const second = entries[1]?.type === 'user_message' ? entries[1] : undefined
    expect(second?.queued).toBeUndefined()
  })

  test('a message sent after the turn ended is not queued', () => {
    let state = reduceSessionEvent(initialChatState, event('user', { content: 'start', uuid: 'u1' }))
    state = reduceSessionEvent(state, event('result', { subtype: 'success', uuid: 'r1' }))
    state = reduceSessionEvent(state, event('user', { content: 'again', uuid: 'u2' }))

    const entries = state.entries.filter((entry) => entry.type === 'user_message')
    const second = entries[1]?.type === 'user_message' ? entries[1] : undefined
    expect(second?.queued).toBeUndefined()
  })

  test('the turn result clears the queued flags', () => {
    let state = reduceSessionEvent(initialChatState, event('session_status', { status: 'running' }))
    state = reduceSessionEvent(state, event('user', { content: 'next task', uuid: 'u1' }))
    state = reduceSessionEvent(state, event('result', { subtype: 'success', uuid: 'r1' }))

    expect(state.entries.filter((entry) => entry.type === 'user_message')).toHaveLength(1)
    expect(userEntry(state)?.queued).toBeUndefined()
  })
})

describe('token usage', () => {
  test('an assistant message records its usage', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        message: { usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90 } },
        content: 'hi',
      }),
    )

    expect(state.lastUsage).toEqual({ input: 10, cached: 90, output: 3 })
  })

  test('messages without usage keep the previous value', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', { message: { usage: { input_tokens: 10, output_tokens: 3 } }, content: 'hi' }),
    )
    state = reduceSessionEvent(state, event('assistant', { content: 'more' }))

    expect(state.lastUsage).toEqual({ input: 10, cached: 0, output: 3 })
  })
})
