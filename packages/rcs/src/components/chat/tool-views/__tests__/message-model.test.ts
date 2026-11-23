import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { messageViewModel } from '../message-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'Brief', status: 'complete', ...overrides }
}

describe('messageViewModel', () => {
  test('reads a delivered brief with attachments', () => {
    const model = messageViewModel(
      tool({
        rawInput: { message: 'Deploy is live', attachments: ['/a.png', '/b.png'], status: 'proactive' },
        rawOutput: { output: 'Message delivered to user. (2 attachments included)' },
      }),
    )
    expect(model).toEqual({ kind: 'brief', message: 'Deploy is live', attachments: 2, delivered: true })
  })

  test('does not flag a brief that has not returned yet', () => {
    const model = messageViewModel(tool({ status: 'running', rawInput: { message: 'Deploy is live' } }))
    expect(model).toEqual({ kind: 'brief', message: 'Deploy is live', attachments: 0, delivered: false })
  })

  test('reads a string send message and its result', () => {
    const output = JSON.stringify({ success: true, message: 'Message delivered to bob' })
    const model = messageViewModel(
      tool({
        title: 'SendMessage',
        rawInput: { to: 'bob', summary: 'Deploy done', message: 'All green' },
        rawOutput: { output },
      }),
    )
    expect(model).toEqual({
      kind: 'send',
      to: 'bob',
      summary: 'Deploy done',
      body: 'All green',
      success: true,
      result: 'Message delivered to bob',
      recipients: [],
    })
  })

  test('serializes a structured message', () => {
    const model = messageViewModel(tool({ title: 'SendMessage', rawInput: { to: 'bob', message: { text: 'hi' } } }))
    expect(model).toMatchObject({ kind: 'send', to: 'bob', body: JSON.stringify({ text: 'hi' }, null, 2) })
  })

  test('reads the recipients of a broadcast', () => {
    const output = JSON.stringify({ success: true, message: 'Broadcast sent', recipients: ['a', 'b'] })
    const model = messageViewModel(
      tool({ title: 'SendMessage', rawInput: { to: '*', message: 'hi' }, rawOutput: { output } }),
    )
    expect(model).toMatchObject({ kind: 'send', to: '*', recipients: ['a', 'b'] })
  })

  test('reports a failed send', () => {
    const output = JSON.stringify({ success: false, message: 'Recipient not found' })
    const model = messageViewModel(
      tool({ title: 'SendMessage', rawInput: { to: 'ghost', message: 'hi' }, rawOutput: { output } }),
    )
    expect(model).toMatchObject({ kind: 'send', success: false, result: 'Recipient not found' })
  })

  test('falls back for other tools and empty calls', () => {
    expect(messageViewModel(tool({ title: 'Bash', rawInput: { command: 'ls' } }))).toBeNull()
    expect(messageViewModel(tool({ rawInput: {} }))).toBeNull()
    expect(messageViewModel(tool({ title: 'SendMessage', rawInput: {} }))).toBeNull()
  })
})
