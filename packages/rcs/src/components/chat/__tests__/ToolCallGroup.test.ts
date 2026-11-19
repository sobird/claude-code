import { describe, expect, test } from 'bun:test'

import type { ToolCallEntry } from '../../../lib/session-reducer'
import { summarizeTools } from '../ToolCallGroup'

function entry(id: string, title: string): ToolCallEntry {
  return { type: 'tool_call', toolCall: { id, title, status: 'running', rawInput: {} } }
}

test('groups adjacent calls by simplified tool name', () => {
  expect(summarizeTools([entry('1', 'Bash'), entry('2', 'Bash'), entry('3', 'Read')])).toEqual({
    total: 3,
    groups: [
      { name: 'Bash', count: 2 },
      { name: 'Read', count: 1 },
    ],
  })
})

test('handles an empty list', () => {
  expect(summarizeTools([])).toEqual({ total: 0, groups: [] })
})
