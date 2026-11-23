import { describe, expect, test } from 'bun:test'

import {
  activeStreamEvents,
  applyHistory,
  foldWithCache,
  hasUnseenEvents,
  initialChatState,
  isAppendOnly,
  isEphemeralEvent,
  reduceSessionEvent,
  type AssistantMessageEntry,
  type ChatState,
  type SessionEventInput,
  type ToolCallEntry,
  type TurnEndEntry,
} from '@/lib/session-reducer'

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

  test('keeps the structured tool_use_result from the user turn', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'WebFetch', input: { url: 'https://x.dev' } }],
        },
      }),
    )
    const toolUseResult = {
      code: 200,
      codeText: 'OK',
      bytes: 1536,
      durationMs: 1200,
      url: 'https://x.dev',
      result: 'hi',
    }
    state = reduceSessionEvent(
      state,
      event('user', {
        tool_use_result: toolUseResult,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi' }],
        },
      }),
    )

    const [call] = tools(state)
    expect(call?.toolCall.rawOutput).toEqual({ output: 'hi', toolUseResult })
  })

  test('tool_result events keep the structured tool_use_result too', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'Grep', input: { pattern: 'TODO' } }],
        },
      }),
    )
    const toolUseResult = { mode: 'count', numFiles: 2, numMatches: 3 }
    state = reduceSessionEvent(
      state,
      event('tool_result', { tool_call_id: 'call-1', content: 'ok', tool_use_result: toolUseResult }),
    )

    const [call] = tools(state)
    expect(call?.toolCall.rawOutput).toEqual({ output: 'ok', toolUseResult })
  })

  test('keeps base64 image blocks from a tool result alongside the text', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/repo/a.png' } }],
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
                { type: 'text', text: 'screenshot' },
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
                },
              ],
            },
          ],
        },
      }),
    )

    const [call] = tools(state)
    expect(call?.toolCall.rawOutput).toEqual({
      output: 'screenshot',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
    })
  })

  test('drops image blocks outside the raster whitelist or missing data', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: '',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
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
                { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zz4=' } },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
                { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
              ],
            },
          ],
        },
      }),
    )

    expect(tools(state)[0]?.toolCall.rawOutput).toEqual({ output: '' })
  })

  test('tool_result events with block content keep text and images apart', () => {
    let state = reduceSessionEvent(initialChatState, event('tool_use', { tool_call_id: 'call-1', tool_name: 'Read' }))
    state = reduceSessionEvent(
      state,
      event('tool_result', {
        tool_call_id: 'call-1',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } },
        ],
      }),
    )

    expect(tools(state)[0]?.toolCall.rawOutput).toEqual({
      output: 'ok',
      images: [{ mediaType: 'image/jpeg', data: '/9j/4AAQ' }],
    })
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

describe('thinking state', () => {
  test('starts empty', () => {
    expect(initialChatState.thinking).toBeNull()
    expect(initialChatState.pendingThinking).toBeNull()
    expect(initialChatState.thinkingError).toBeNull()
  })

  test('an outbound set_max_thinking_tokens request starts a pending change', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'control_request',
        { request_id: 'think-1', request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 31999 } },
        { direction: 'outbound' },
      ),
    )

    expect(state.pendingThinking).toEqual({ requestId: 'think-1', choice: 'on' })
    expect(state.thinkingError).toBeNull()
    expect(state.entries).toHaveLength(0)
  })

  test('the echoed budget maps to the choice', () => {
    const off = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 },
      }),
    )
    expect(off.pendingThinking).toEqual({ requestId: 'think-1', choice: 'off' })

    const reset = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-2',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: null },
      }),
    )
    expect(reset.pendingThinking).toEqual({ requestId: 'think-2', choice: 'default' })
  })

  test('a successful response adopts the choice', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 31999 },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'think-1', subtype: 'success' } }),
    )

    expect(state.thinking).toBe('on')
    expect(state.pendingThinking).toBeNull()
    expect(state.thinkingError).toBeNull()
  })

  test('a default reset clears the adopted choice', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 31999 },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'think-1', subtype: 'success' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_request', {
        request_id: 'think-2',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: null },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'think-2', subtype: 'success' } }),
    )

    expect(state.thinking).toBeNull()
  })

  test('an error response keeps the state and records the error', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', {
        response: { request_id: 'think-1', subtype: 'error', error: 'thinking unsupported' },
      }),
    )

    expect(state.thinking).toBeNull()
    expect(state.pendingThinking).toBeNull()
    expect(state.thinkingError).toBe('thinking unsupported')
  })

  test('control_cancel_request clears a matching pending change', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 31999 },
      }),
    )
    state = reduceSessionEvent(state, event('control_cancel_request', { request_id: 'think-1' }))

    expect(state.pendingThinking).toBeNull()
  })

  test('mode, model, and thinking settlements do not interfere', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'init', permissionMode: 'default', model: 'sonnet' }),
    )
    state = reduceSessionEvent(
      state,
      event('control_request', {
        request_id: 'think-1',
        request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 31999 },
      }),
    )
    // A mode response for a different request must not settle the thinking request.
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'other', subtype: 'success' } }),
    )

    expect(state.pendingThinking).toEqual({ requestId: 'think-1', choice: 'on' })
    expect(state.thinking).toBeNull()

    state = reduceSessionEvent(
      state,
      event('control_response', { response: { request_id: 'think-1', subtype: 'success' } }),
    )
    expect(state.pendingThinking).toBeNull()
    expect(state.pendingMode).toBeNull()
    expect(state.pendingModel).toBeNull()
  })
})

describe('system transcript rows', () => {
  test('compact_boundary appends a row with content and level', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'compact_boundary', content: 'Compacted', level: 'info' }),
    )
    const rows = state.entries.filter((entry) => entry.type === 'system')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'system', subtype: 'compact_boundary', content: 'Compacted', level: 'info' })
  })

  test('permission_retry keeps commands and memory_saved keeps writtenPaths', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('system', { subtype: 'permission_retry', commands: ['Bash(npm test:*)', 42] }),
    )
    state = reduceSessionEvent(state, event('system', { subtype: 'memory_saved', writtenPaths: ['/repo/a.md'] }))
    const rows = state.entries.filter((entry) => entry.type === 'system')

    expect(rows[0]).toMatchObject({ commands: ['Bash(npm test:*)'] })
    expect(rows[1]).toMatchObject({ writtenPaths: ['/repo/a.md'] })
  })

  test('init and status do not append rows', () => {
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'init', slash_commands: [] }))
    state = reduceSessionEvent(state, event('system', { subtype: 'status', permissionMode: 'plan' }))
    expect(state.entries).toHaveLength(0)
  })

  test('unknown subtypes are ignored', () => {
    const state = reduceSessionEvent(initialChatState, event('system', { subtype: 'api_metrics', content: 'x' }))
    expect(state.entries).toHaveLength(0)
  })

  test('a replayed row dedupes by seqNum', () => {
    const sequence = nextSeqNum
    let state = reduceSessionEvent(initialChatState, event('system', { subtype: 'local_command', content: '/compact' }))
    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'local_command', content: '/compact' }, { seqNum: sequence }),
    )
    expect(state.entries.filter((entry) => entry.type === 'system')).toHaveLength(1)
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

  test('a durable subagent message only closes its own thread window', () => {
    const frames: SessionEventInput[] = [
      streamEvent(textDelta('main-prefix'), { seqNum: 9_000_000_001 }),
      subagentStreamEvent(textDelta('sub-prefix'), 'toolu_x'),
      event('assistant', { content: 'sub done', parent_tool_use_id: 'toolu_x' }, { seqNum: 5 }),
      streamEvent(textDelta('main-tail'), { seqNum: 9_000_000_003 }),
    ]

    // The subagent's durable message retires its streamed prefix; the main
    // thread is still streaming, so its deltas survive on both sides.
    expect(activeStreamEvents(frames).map((frame) => frame.seqNum)).toEqual([9_000_000_001, 9_000_000_003])
  })

  test('a durable main-thread message keeps an in-flight subagent window', () => {
    const frames: SessionEventInput[] = [
      subagentStreamEvent(textDelta('sub-a'), 'toolu_x'),
      event('assistant', { content: 'main done' }, { seqNum: 5 }),
      subagentStreamEvent(textDelta('sub-b'), 'toolu_x'),
    ]

    expect(activeStreamEvents(frames).map((frame) => frame.seqNum)).toEqual(
      frames.filter(isEphemeralEvent).map((frame) => frame.seqNum),
    )
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

describe('result watermark', () => {
  test('records the seqNum of the latest result and never regresses', () => {
    let state = reduceSessionEvent(initialChatState, event('result', { subtype: 'success' }, { seqNum: 7 }))
    expect(state.lastResultSeq).toBe(7)

    state = reduceSessionEvent(state, event('assistant', { content: 'later' }, { seqNum: 8 }))
    expect(state.lastResultSeq).toBe(7)

    // 重连重放旧帧不应把水位拉回去。
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }, { seqNum: 3 }))
    expect(state.lastResultSeq).toBe(7)

    state = reduceSessionEvent(state, event('result', { subtype: 'success' }, { seqNum: 11 }))
    expect(state.lastResultSeq).toBe(11)
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

  test('a TodoWrite records the previous list as its baseline', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        message: {
          content: [
            todoBlock([
              { content: 'One', status: 'pending' },
              { content: 'Two', status: 'pending' },
            ]),
          ],
        },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('assistant', {
        message: {
          content: [
            todoBlock([
              { content: 'One', status: 'completed' },
              { content: 'Three', status: 'pending' },
            ]),
          ],
        },
      }),
    )

    const calls = tools(state)
    expect(calls[0]?.toolCall.baselineTodos).toBeUndefined()
    expect(calls[1]?.toolCall.baselineTodos?.map((task) => task.content)).toEqual(['One', 'Two'])
  })

  test('a standalone tool_use event also records the baseline', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('tool_use', {
        tool_call_id: 'call-a',
        tool_name: 'TodoWrite',
        tool_input: { todos: [{ content: 'One', status: 'pending' }] },
      }),
    )
    state = reduceSessionEvent(
      state,
      event('tool_use', {
        tool_call_id: 'call-b',
        tool_name: 'TodoWrite',
        tool_input: { todos: [{ content: 'Two', status: 'pending' }] },
      }),
    )

    const calls = tools(state)
    expect(calls[1]?.toolCall.baselineTodos?.map((task) => task.content)).toEqual(['One'])
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

  test('the queue lane is kept on the entry; steering stays the implicit default', () => {
    let state = reduceSessionEvent(initialChatState, event('session_status', { status: 'running' }))
    state = reduceSessionEvent(state, event('user', { content: 'later', uuid: 'u1', delivery: 'queue' }))
    state = reduceSessionEvent(state, event('user', { content: 'now', uuid: 'u2', delivery: 'steer' }))

    const entries = state.entries.filter((entry) => entry.type === 'user_message')
    expect(entries[0]?.type === 'user_message' ? entries[0].delivery : undefined).toBe('queue')
    expect(entries[1]?.type === 'user_message' ? entries[1].delivery : undefined).toBeUndefined()
  })
})

// The CLI emits subagent traffic as ordinary assistant/user messages that carry
// the parent Agent tool call id at the top level (`parent_tool_use_id`); the
// gateway keeps the original message under `raw`. The reducer keeps one flat
// transcript and records a parent pointer on each derived entry; the render
// layer builds the tree from it.
const AGENT_CALL = 'toolu_agent'

function subagentAssistant(text: string, parent: string = AGENT_CALL): SessionEventInput {
  return event('assistant', { content: text, parent_tool_use_id: parent })
}

function subagentStreamEvent(inner: Record<string, unknown>, parent: string = AGENT_CALL): SessionEventInput {
  return event('stream_event', { type: 'stream_event', parent_tool_use_id: parent, event: inner }, { ephemeral: true })
}

describe('subagent messages', () => {
  test('subagent assistant text does not merge into the main assistant message', () => {
    let state = reduceSessionEvent(initialChatState, event('assistant', { content: 'main' }))
    state = reduceSessionEvent(state, subagentAssistant('sub'))

    const messages = assistants(state)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.chunks).toEqual([{ type: 'message', text: 'main' }])
    expect(messages[0]?.parentToolUseId).toBeUndefined()
    expect(messages[1]?.chunks).toEqual([{ type: 'message', text: 'sub' }])
    expect(messages[1]?.parentToolUseId).toBe(AGENT_CALL)
  })

  test('consecutive subagent messages under the same agent merge together', () => {
    let state = reduceSessionEvent(initialChatState, subagentAssistant('part one '))
    state = reduceSessionEvent(state, subagentAssistant('part two'))

    expect(assistants(state)).toHaveLength(1)
    expect(assistants(state)[0]?.chunks).toEqual([{ type: 'message', text: 'part one part two' }])
  })

  test('reads the parent pointer from the gateway-normalized raw payload', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        content: 'sub',
        raw: {
          type: 'assistant',
          parent_tool_use_id: AGENT_CALL,
          message: { content: [{ type: 'text', text: 'sub' }] },
        },
      }),
    )

    expect(assistants(state)[0]?.parentToolUseId).toBe(AGENT_CALL)
  })

  test('a subagent message does not drop the main thread streaming bubble', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('main')))
    state = reduceSessionEvent(state, subagentAssistant('sub'))

    const streaming = assistants(state).find((entry) => entry.streaming)
    expect(streaming?.chunks).toEqual([{ type: 'message', text: 'main' }])
    const sub = assistants(state).find((entry) => entry.parentToolUseId === AGENT_CALL)
    expect(sub?.chunks).toEqual([{ type: 'message', text: 'sub' }])
  })

  test('subagent tool calls carry the parent pointer', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event('assistant', {
        parent_tool_use_id: AGENT_CALL,
        message: { content: [{ type: 'tool_use', id: 'toolu_sub', name: 'Read', input: {} }] },
      }),
    )

    const [call] = tools(state)
    expect(call?.parentToolUseId).toBe(AGENT_CALL)
  })

  test('a positional tool_result settles a call in its own thread only', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('tool_use', { tool_call_id: 'call-main', tool_name: 'Read' }),
    )
    state = reduceSessionEvent(
      state,
      event('tool_use', { tool_call_id: 'toolu_sub', tool_name: 'Bash', parent_tool_use_id: AGENT_CALL }),
    )
    // No id, no parent: a main-thread result must skip the interleaved subagent call.
    state = reduceSessionEvent(state, event('tool_result', { content: 'done' }))

    let calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'call-main')?.toolCall.status).toBe('complete')
    expect(calls.find((call) => call.toolCall.id === 'toolu_sub')?.toolCall.status).toBe('running')

    state = reduceSessionEvent(state, event('tool_result', { content: 'sub done', parent_tool_use_id: AGENT_CALL }))
    calls = tools(state)
    expect(calls.find((call) => call.toolCall.id === 'toolu_sub')?.toolCall.status).toBe('complete')
  })

  test('a subagent user turn settles tool results without rendering a prompt bubble', () => {
    let state = reduceSessionEvent(
      initialChatState,
      event('tool_use', { tool_call_id: 'toolu_sub', tool_name: 'Bash', parent_tool_use_id: AGENT_CALL }),
    )
    state = reduceSessionEvent(
      state,
      event('user', {
        parent_tool_use_id: AGENT_CALL,
        content: 'internal note',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_sub', content: 'ok' },
            { type: 'text', text: 'internal note' },
          ],
        },
      }),
    )

    expect(state.entries.filter((entry) => entry.type === 'user_message')).toHaveLength(0)
    expect(tools(state)[0]?.toolCall.status).toBe('complete')
  })

  test('a subagent stream delta streams in its own bubble under the Agent call', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('main')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('sub')))

    const streaming = assistants(state).filter((entry) => entry.streaming)
    expect(streaming).toHaveLength(2)
    expect(streaming.find((entry) => entry.parentToolUseId === undefined)?.chunks).toEqual([
      { type: 'message', text: 'main' },
    ])
    expect(streaming.find((entry) => entry.parentToolUseId === AGENT_CALL)?.chunks).toEqual([
      { type: 'message', text: 'sub' },
    ])
  })

  test('interleaved deltas accumulate in their own threads', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('a')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('x')))
    state = reduceSessionEvent(state, streamEvent(textDelta('b')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('y')))

    const streaming = assistants(state).filter((entry) => entry.streaming)
    expect(streaming.find((entry) => entry.parentToolUseId === undefined)?.chunks).toEqual([
      { type: 'message', text: 'ab' },
    ])
    expect(streaming.find((entry) => entry.parentToolUseId === AGENT_CALL)?.chunks).toEqual([
      { type: 'message', text: 'xy' },
    ])
  })

  test('reads the parent pointer from gateway-normalized raw stream payloads', () => {
    const state = reduceSessionEvent(
      initialChatState,
      event(
        'stream_event',
        { content: '', raw: { type: 'stream_event', parent_tool_use_id: AGENT_CALL, event: textDelta('sub') } },
        { ephemeral: true },
      ),
    )

    expect(assistants(state)[0]?.parentToolUseId).toBe(AGENT_CALL)
  })

  test('message_start resets only its own thread', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('main')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('sub')))
    state = reduceSessionEvent(state, subagentStreamEvent({ type: 'message_start' }))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('next')))

    const streaming = assistants(state).filter((entry) => entry.streaming)
    expect(streaming.find((entry) => entry.parentToolUseId === undefined)?.chunks).toEqual([
      { type: 'message', text: 'main' },
    ])
    expect(streaming.find((entry) => entry.parentToolUseId === AGENT_CALL)?.chunks).toEqual([
      { type: 'message', text: 'next' },
    ])
  })

  test('a durable subagent message replaces only its own streamed bubble', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('main')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('sub')))
    state = reduceSessionEvent(state, subagentAssistant('sub'))

    const streaming = assistants(state).filter((entry) => entry.streaming)
    expect(streaming).toHaveLength(1)
    expect(streaming[0]?.chunks).toEqual([{ type: 'message', text: 'main' }])
    const sub = assistants(state).find((entry) => entry.parentToolUseId === AGENT_CALL && !entry.streaming)
    expect(sub?.chunks).toEqual([{ type: 'message', text: 'sub' }])
  })

  test('a turn result drops every thread\u2019s streaming bubble', () => {
    let state = reduceSessionEvent(initialChatState, streamEvent(textDelta('main')))
    state = reduceSessionEvent(state, subagentStreamEvent(textDelta('sub')))
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }))

    expect(assistants(state).filter((entry) => entry.streaming)).toHaveLength(0)
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

describe('background tasks', () => {
  function started(taskId = 't1', extra: Record<string, unknown> = {}): SessionEventInput {
    return event('system', {
      subtype: 'task_started',
      task_id: taskId,
      description: 'Review auth',
      task_type: 'local_agent',
      tool_use_id: 'call-1',
      ...extra,
    })
  }

  test('task_started records the task with the event time as its start', () => {
    const state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })

    expect(state.backgroundTasks).toEqual([
      {
        taskId: 't1',
        description: 'Review auth',
        taskType: 'local_agent',
        toolUseId: 'call-1',
        startedAt: 1_000,
      },
    ])
    expect(state.turnOpen).toBe(true)
  })

  test('a replayed task_started keeps the first start time and does not duplicate', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(state, { ...started('t1'), createdAt: 2_000 })

    expect(state.backgroundTasks).toHaveLength(1)
    expect(state.backgroundTasks[0]?.startedAt).toBe(1_000)
  })

  test('task_progress merges usage and keeps the recorded start', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(
      state,
      event('system', {
        subtype: 'task_progress',
        task_id: 't1',
        usage: { totalTokens: 900, toolUses: 3, durationMs: 12_000 },
        last_tool_name: 'Read',
        summary: 'halfway',
      }),
    )

    expect(state.backgroundTasks[0]).toMatchObject({
      taskId: 't1',
      startedAt: 1_000,
      lastToolName: 'Read',
      summary: 'halfway',
      usage: { totalTokens: 900, toolUses: 3, durationMs: 12_000 },
    })
  })

  test('task_notification removes the task and appends a transcript row', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'done' }),
    )

    expect(state.backgroundTasks).toEqual([])
    const rows = state.entries.filter((entry) => entry.type === 'system')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'system',
      subtype: 'task_notification',
      content: 'done',
      taskStatus: 'completed',
    })
  })

  test('a result clears every turn-scoped task', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(state, { ...started('t2'), createdAt: 1_000 })
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }))

    expect(state.backgroundTasks).toEqual([])
  })

  test('a result keeps background shells alive across turns', () => {
    // The CLI only holds `result` back for agents/workflows; a background bash
    // task keeps running after the turn ends and reports via task_notification.
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash', description: 'dev server' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }))

    expect(state.backgroundTasks).toEqual([
      expect.objectContaining({ taskId: 'shell-1', taskType: 'local_bash', description: 'dev server' }),
    ])
  })

  test('session_state_changed idle clears the list without touching the turn clock', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(state, event('system', { subtype: 'session_state_changed', state: 'idle' }))

    expect(state.backgroundTasks).toEqual([])
    expect(state.turnOpen).toBe(true)
  })

  test('session_state_changed idle keeps background shells', () => {
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(state, event('system', { subtype: 'session_state_changed', state: 'idle' }))

    expect(state.backgroundTasks).toEqual([expect.objectContaining({ taskId: 'shell-1', taskType: 'local_bash' })])
  })

  test('a shell task disappears when its task_notification arrives', () => {
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(state, event('result', { subtype: 'success' }))
    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'task_notification', task_id: 'shell-1', status: 'completed', summary: 'exit 0' }),
    )

    expect(state.backgroundTasks).toEqual([])
  })

  test('an archived session still clears background shells', () => {
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(state, event('session_status', { status: 'archived' }))

    expect(state.backgroundTasks).toEqual([])
  })

  test('session_state_changed running keeps the list', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(state, event('system', { subtype: 'session_state_changed', state: 'running' }))

    expect(state.backgroundTasks).toHaveLength(1)
  })

  test('an archived session status clears the list', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    state = reduceSessionEvent(state, event('session_status', { status: 'archived' }))

    expect(state.backgroundTasks).toEqual([])
  })

  test('replaying a start → progress → notification sequence leaves no running tasks', () => {
    const history = [
      started('t1'),
      event('system', {
        subtype: 'task_progress',
        task_id: 't1',
        usage: { totalTokens: 10, toolUses: 1, durationMs: 5 },
      }),
      event('system', { subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'done' }),
    ]
    const state = applyHistory(initialChatState, history)

    expect(state.backgroundTasks).toEqual([])
  })

  test('an error response to stop_task clears the row (stale task on the CLI)', () => {
    // The child answers `not_running` when the row survived a restart: its
    // task state is gone, so no task_notification will ever close the row.
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'stop-1', request: { subtype: 'stop_task', task_id: 'shell-1' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', {
        response: { subtype: 'error', request_id: 'stop-1', error: 'Task shell-1 is not running (status: killed)' },
      }),
    )

    expect(state.backgroundTasks).toEqual([])
  })

  test('a successful stop clears the row without waiting for a notification', () => {
    // The stop reply is authoritative: the CLI killed the task. Some CLI
    // versions suppress the closing task_notification for killed shells, so
    // waiting for it would leave "stopping…" on screen forever. A late
    // notification (if any) must not resurrect the row.
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'stop-1', request: { subtype: 'stop_task', task_id: 'shell-1' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { subtype: 'success', request_id: 'stop-1' } }),
    )

    expect(state.backgroundTasks).toEqual([])

    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'task_notification', task_id: 'shell-1', status: 'stopped', summary: 'stopped' }),
    )
    expect(state.backgroundTasks).toEqual([])
  })

  test('replaying a stop that errored leaves no stale row', () => {
    const history = [
      started('shell-1', { task_type: 'local_bash' }),
      event('control_request', { request_id: 'stop-1', request: { subtype: 'stop_task', task_id: 'shell-1' } }),
      event('control_response', {
        response: { subtype: 'error', request_id: 'stop-1', error: 'Task shell-1 is not running (status: killed)' },
      }),
    ]
    const state = applyHistory(initialChatState, history)

    expect(state.backgroundTasks).toEqual([])
  })

  test('an error response to another control request leaves rows alone', () => {
    let state = reduceSessionEvent(initialChatState, {
      ...started('shell-1', { task_type: 'local_bash' }),
      createdAt: 1_000,
    })
    state = reduceSessionEvent(
      state,
      event('control_request', { request_id: 'model-1', request: { subtype: 'set_model', model: 'x' } }),
    )
    state = reduceSessionEvent(
      state,
      event('control_response', { response: { subtype: 'error', request_id: 'model-1', error: 'nope' } }),
    )

    expect(state.backgroundTasks).toEqual([expect.objectContaining({ taskId: 'shell-1' })])
  })

  test('a replayed task_notification row dedupes by seqNum', () => {
    let state = reduceSessionEvent(initialChatState, { ...started('t1'), createdAt: 1_000 })
    const sequence = nextSeqNum
    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'task_notification', task_id: 't1', status: 'completed' }, { seqNum: sequence }),
    )
    state = reduceSessionEvent(
      state,
      event('system', { subtype: 'task_notification', task_id: 't1', status: 'completed' }, { seqNum: sequence }),
    )

    expect(state.entries.filter((entry) => entry.type === 'system')).toHaveLength(1)
  })
})

describe('isAppendOnly', () => {
  function seq(seqNum: number): SessionEventInput {
    return { id: `e${seqNum}`, seqNum, type: 'assistant', payload: { content: `s${seqNum}` }, direction: 'inbound' }
  }

  test('accepts a longer list that keeps the same prefix', () => {
    expect(isAppendOnly([seq(1), seq(2)], [seq(1), seq(2), seq(3)])).toBe(true)
  })

  test('accepts an identical list', () => {
    const events = [seq(1), seq(2)]
    expect(isAppendOnly(events, events)).toBe(true)
  })

  test('rejects a shorter list', () => {
    expect(isAppendOnly([seq(1), seq(2)], [seq(1)])).toBe(false)
  })

  test('rejects prepended older events', () => {
    expect(isAppendOnly([seq(5), seq(6)], [seq(3), seq(4), seq(5), seq(6)])).toBe(false)
  })

  test('rejects a replaced prefix of the same length', () => {
    expect(isAppendOnly([seq(1), seq(2)], [seq(1), seq(9), seq(10)])).toBe(false)
  })

  test('compares by seqNum and id rather than object identity', () => {
    const previous: SessionEventInput = { id: 'same-id', seqNum: 7, type: 'assistant', payload: { content: 'a' } }
    expect(isAppendOnly([previous], [{ ...previous }])).toBe(true)
  })
})

describe('foldWithCache', () => {
  function seq(seqNum: number, content = `s${seqNum}`): SessionEventInput {
    return { id: `e${seqNum}`, seqNum, type: 'assistant', payload: { content }, direction: 'inbound' }
  }

  function fullFold(events: SessionEventInput[]): ChatState {
    return applyHistory(initialChatState, events)
  }

  test('folds from scratch when there is no cache', () => {
    const events = [seq(1), seq(2)]
    const folded = foldWithCache(null, events)
    expect(folded.events).toBe(events)
    expect(folded.state.entries).toEqual(fullFold(events).entries)
  })

  test('matches a full fold after appending a tail event', () => {
    const first = [seq(1), seq(2)]
    const cached = foldWithCache(null, first)
    const next = [...first, seq(3)]
    const folded = foldWithCache(cached, next)
    const expected = fullFold(next)
    expect(folded.events).toBe(next)
    expect(folded.state.entries).toEqual(expected.entries)
    expect(folded.state.lastSeqNum).toBe(expected.lastSeqNum)
    expect([...folded.state.seenSeqNums]).toEqual([...expected.seenSeqNums])
  })

  test('reuses the cached state when nothing was appended', () => {
    const events = [seq(1), seq(2)]
    const cached = foldWithCache(null, events)
    expect(foldWithCache(cached, events).state).toBe(cached.state)
  })

  test('falls back to a full fold when older events are prepended', () => {
    const recent = [seq(5), seq(6)]
    const cached = foldWithCache(null, recent)
    const withOlder = [seq(3), seq(4), ...recent]
    const folded = foldWithCache(cached, withOlder)
    expect(folded.events).toBe(withOlder)
    expect(folded.state.entries).toEqual(fullFold(withOlder).entries)
    expect([...folded.state.seenSeqNums]).toEqual([...fullFold(withOlder).seenSeqNums])
  })

  test('falls back to a full fold when the prefix was replaced', () => {
    const cached = foldWithCache(null, [seq(1), seq(2)])
    const replaced = [seq(1), seq(9)]
    const folded = foldWithCache(cached, replaced)
    expect(folded.state.entries).toEqual(fullFold(replaced).entries)
  })
})

describe('hasUnseenEvents', () => {
  function seq(seqNum: number | undefined): SessionEventInput {
    return { seqNum, type: 'assistant', payload: { content: 'x' } }
  }

  test('reports a page already covered by known sequence numbers', () => {
    expect(hasUnseenEvents([seq(1), seq(2)], new Set([1, 2, 3]))).toBe(false)
  })

  test('detects an event the client has not seen', () => {
    expect(hasUnseenEvents([seq(1), seq(4)], new Set([1, 2]))).toBe(true)
  })

  test('treats an empty page as fully covered', () => {
    expect(hasUnseenEvents([], new Set([1]))).toBe(false)
  })

  test('cannot prove coverage for an event without a sequence number', () => {
    expect(hasUnseenEvents([seq(undefined)], new Set([1]))).toBe(true)
  })
})
