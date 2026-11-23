import { describe, expect, test } from 'bun:test'

import {
  allowRulesOf,
  approvalRequestEvent,
  approvalResult,
  parseControlResponse,
  promptBlocks,
  questionRequestEvent,
  questionResult,
  translateSessionEvent,
} from '../translate'

describe('translateSessionEvent', () => {
  test('assistant text drops tool-call blocks and keeps a stable uuid', () => {
    const events = translateSessionEvent({
      type: 'assistant/message',
      seq: 12,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '先看目录' },
            { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"ls"}' },
            { type: 'text', text: '，然后执行。' },
          ],
        },
      },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'assistant',
      payload: {
        type: 'assistant',
        uuid: 'dsh-a-12',
        message: { role: 'assistant', content: [{ type: 'text', text: '先看目录，然后执行。' }] },
      },
    })
  })

  test('empty assistant message yields no event', () => {
    const events = translateSessionEvent({
      type: 'assistant/message',
      seq: 3,
      data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'hmm' }] } },
    })
    expect(events).toEqual([])
  })

  test('tool/call parses raw arguments into tool_input', () => {
    const events = translateSessionEvent({
      type: 'tool/call',
      seq: 13,
      data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls","cwd":"/tmp"}' },
    })
    expect(events).toEqual([
      {
        type: 'tool_use',
        payload: {
          type: 'tool_use',
          tool_call_id: 'call-1',
          tool_name: 'bash',
          tool_input: { command: 'ls', cwd: '/tmp' },
        },
      },
    ])
  })

  test('tool/result becomes a synthetic user tool_result', () => {
    const events = translateSessionEvent({
      type: 'tool/result',
      seq: 14,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call-1',
          isError: true,
          content: [{ type: 'text', text: 'permission denied' }],
        },
      },
    })
    expect(events).toEqual([
      {
        type: 'user',
        payload: {
          type: 'user',
          uuid: 'dsh-t-14',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call-1',
                content: [{ type: 'text', text: 'permission denied' }],
                is_error: true,
              },
            ],
          },
        },
      },
    ])
  })

  test.each([
    [{ kind: 'completed' }, 'success', undefined],
    [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'aborted', 'Interrupted'],
    [{ kind: 'error', error: { message: 'rate limited', code: 'RATE' } }, 'error', 'rate limited'],
  ] as const)('turn/end %j maps to result %s', (reason, subtype, message) => {
    const [event] = translateSessionEvent({ type: 'turn/end', seq: 20, data: { turn: 1, reason } })
    expect(event?.type).toBe('result')
    expect(event?.payload.subtype).toBe(subtype)
    if (message === undefined) {
      expect(event?.payload.result).toBeUndefined()
      expect(event?.payload.is_error).toBeUndefined()
    } else {
      expect(event?.payload.result).toBe(message)
      expect(event?.payload.is_error).toBe(true)
    }
  })

  test('user/message is not echoed back to RCS', () => {
    expect(translateSessionEvent({ type: 'user/message', seq: 2, data: { content: [] } })).toEqual([])
    expect(translateSessionEvent({ type: 'plan/mode', seq: 5, data: { active: true } })).toEqual([])
  })
})

describe('promptBlocks', () => {
  test('accepts a plain string and wire block arrays with hydrated images', () => {
    expect(promptBlocks({ content: '你好' })).toEqual([{ type: 'text', text: '你好' }])
    expect(promptBlocks({ message: { role: 'user', content: '嗨' } })).toEqual([{ type: 'text', text: '嗨' }])
    expect(
      promptBlocks({
        message: {
          content: [
            { type: 'text', text: '看图' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            { type: 'image', source: { type: 'attachment', id: 'att_1' } },
            { type: 'tool_use', id: 'x', name: 'y', input: {} },
          ],
        },
      }),
    ).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ])
  })

  test('unknown shapes yield no blocks', () => {
    expect(promptBlocks({ content: 42 })).toEqual([])
  })
})

describe('control responses', () => {
  const wrapped = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'p1',
      response: { behavior: 'allow', updatedInput: { answers: { Q: 'A' } }, updatedPermissions: [] },
    },
  }

  test('parses the wrapped SSE shape', () => {
    expect(parseControlResponse(wrapped)).toEqual({
      approved: true,
      updatedInput: { answers: { Q: 'A' } },
      updatedPermissions: [],
      message: '',
    })
  })

  test('parses the flat fallback shape and a denial message', () => {
    expect(parseControlResponse({ approved: false, request_id: 'p1', message: '不要执行' })).toEqual({
      approved: false,
      updatedInput: {},
      updatedPermissions: [],
      message: '不要执行',
    })
  })

  test('approval outcome is one-shot allow or reject', () => {
    expect(approvalResult({ approved: true, updatedInput: {}, updatedPermissions: [], message: '' })).toEqual({
      outcome: 'allowed-once',
    })
    expect(approvalResult({ approved: false, updatedInput: {}, updatedPermissions: [], message: '' })).toEqual({
      outcome: 'rejected',
    })
  })

  test('allowRulesOf extracts session allow rules only', () => {
    const resolution = parseControlResponse({
      approved: true,
      updated_permissions: [
        { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'bash' }] },
        { type: 'addRules', behavior: 'deny', rules: [{ toolName: 'write' }] },
        { type: 'setMode', mode: 'acceptEdits' },
      ],
    })
    if (!resolution) throw new Error('expected a parsed resolution')
    expect(allowRulesOf(resolution)).toEqual([{ toolName: 'bash' }])
  })
})

describe('approval requests', () => {
  test('maps to a can_use_tool card with an allow-session suggestion', () => {
    const event = approvalRequestEvent('req-1', {
      sessionId: 'cse_1',
      toolName: 'bash',
      callId: 'call-9',
      reason: 'escalate sandbox to danger-full-access',
    })
    expect(event).toEqual({
      type: 'control_request',
      payload: {
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          tool_use_id: 'call-9',
          description: 'escalate sandbox to danger-full-access',
          input: {},
          permission_suggestions: [
            { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'bash' }] },
          ],
        },
      },
    })
  })
})

describe('question requests', () => {
  test('plan-review intent becomes an ExitPlanMode card carrying the plan markdown', () => {
    const event = questionRequestEvent('q-1', {
      requestId: 'native-1',
      sessionId: 'cse_1',
      questions: [
        {
          id: 'plan-review',
          question: 'Approve this plan?',
          header: 'Plan review',
          detail: '# Plan\n\n1. do it',
          options: [{ label: 'Approve' }, { label: 'Revise' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
        },
      ],
    })
    expect(event.payload.request).toMatchObject({
      subtype: 'can_use_tool',
      tool_name: 'ExitPlanMode',
      input: { plan: '# Plan\n\n1. do it' },
    })
  })

  test('generic questions become AskUserQuestion input', () => {
    const event = questionRequestEvent('q-2', {
      questions: [
        {
          id: 'q1',
          question: '用哪个数据库？',
          header: '数据库',
          options: [{ label: 'Postgres', description: '默认' }, { label: 'SQLite' }],
          multiSelect: false,
        },
      ],
    })
    expect(event.payload.request).toMatchObject({
      tool_name: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: '用哪个数据库？',
            header: '数据库',
            options: [{ label: 'Postgres', description: '默认' }, { label: 'SQLite' }],
            multiSelect: false,
          },
        ],
      },
    })
  })
})

describe('questionResult', () => {
  const genericParams = {
    questions: [
      {
        id: 'q1',
        question: '用哪个？',
        options: [{ label: 'A' }, { label: 'B' }],
        multiSelect: true,
      },
    ],
  }

  test('splits selected labels from custom free text', () => {
    expect(
      questionResult(genericParams, {
        approved: true,
        updatedInput: { answers: { '用哪个？': 'A, 自定义内容' } },
        updatedPermissions: [],
        message: '',
      }),
    ).toEqual({ answers: [{ id: 'q1', selected: ['A'], custom: '自定义内容' }] })
  })

  test('a denied generic question closes as cancelled', () => {
    expect(
      questionResult(genericParams, { approved: false, updatedInput: {}, updatedPermissions: [], message: '' }),
    ).toEqual({ cancelled: true })
  })

  const planParams = {
    questions: [
      {
        id: 'plan-review',
        question: 'Approve?',
        options: [{ label: 'Approve' }, { label: 'Revise' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      },
    ],
  }

  test('plan approval selects the approve label', () => {
    expect(
      questionResult(planParams, { approved: true, updatedInput: {}, updatedPermissions: [], message: '' }),
    ).toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  })

  test('plan rejection selects the decline label and forwards feedback', () => {
    expect(
      questionResult(planParams, {
        approved: false,
        updatedInput: {},
        updatedPermissions: [],
        message: '先补测试',
      }),
    ).toEqual({ answers: [{ id: 'plan-review', selected: ['Revise'], custom: '先补测试' }] })
  })
})
