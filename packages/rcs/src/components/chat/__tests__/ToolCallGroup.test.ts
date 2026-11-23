import { expect, test } from 'bun:test'

import { summarizeTools } from '@/components/chat/ToolCallGroup'
import type { ToolCallEntry } from '@/lib/session-reducer'

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

test('labels MCP groups with the tool over its server', () => {
  expect(summarizeTools([entry('1', 'mcp__a__echo'), entry('2', 'mcp__a__echo'), entry('3', 'mcp__b__echo')])).toEqual({
    total: 3,
    groups: [
      { name: 'echo · a', count: 2 },
      { name: 'echo · b', count: 1 },
    ],
  })
})

test('handles an empty list', () => {
  expect(summarizeTools([])).toEqual({ total: 0, groups: [] })
})
