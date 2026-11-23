import { expect, test } from 'bun:test'

import type { ThreadEntry, ToolCallEntry } from '@/lib/session-reducer'
import { summarizeTurns } from '@/lib/turn-summary'

function user(id: string): ThreadEntry {
  return { type: 'user_message', id, content: id }
}

function tool(id: string, status: ToolCallEntry['toolCall']['status'], parentToolUseId?: string): ToolCallEntry {
  return { type: 'tool_call', toolCall: { id, title: 'Bash', status, rawInput: {} }, parentToolUseId }
}

function turnEnd(id: string, durationMs: number): ThreadEntry {
  return { type: 'turn_end', id, durationMs }
}

test('counts top-level tools per turn', () => {
  const summaries = summarizeTurns([
    user('u1'),
    tool('t1', 'complete'),
    tool('t2', 'complete'),
    turnEnd('e1', 1200),
    user('u2'),
    tool('t3', 'complete'),
    turnEnd('e2', 300),
  ])

  expect(summaries.get('e1')).toEqual({ tools: 2, errors: 0, durationMs: 1200 })
  expect(summaries.get('e2')).toEqual({ tools: 1, errors: 0, durationMs: 300 })
})

test('counts errored tools separately', () => {
  const summaries = summarizeTurns([user('u1'), tool('t1', 'error'), tool('t2', 'complete'), turnEnd('e1', 500)])
  expect(summaries.get('e1')).toEqual({ tools: 2, errors: 1, durationMs: 500 })
})

test('ignores tools whose parent is a subagent call', () => {
  const summaries = summarizeTurns([
    user('u1'),
    tool('t1', 'complete', 'agent-1'),
    tool('t2', 'complete'),
    turnEnd('e1', 400),
  ])
  expect(summaries.get('e1')).toEqual({ tools: 1, errors: 0, durationMs: 400 })
})

test('reports zero tools for a turn without calls', () => {
  const summaries = summarizeTurns([user('u1'), turnEnd('e1', 90)])
  expect(summaries.get('e1')).toEqual({ tools: 0, errors: 0, durationMs: 90 })
})
