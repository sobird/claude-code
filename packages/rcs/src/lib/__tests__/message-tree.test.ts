import { describe, expect, test } from 'bun:test'

import { buildThreadTree } from '../message-tree'
import type { AssistantMessageEntry, ThreadEntry, ToolCallEntry } from '../session-reducer'

function assistant(id: string, text: string, parentToolUseId?: string): AssistantMessageEntry {
  return { type: 'assistant_message', id, chunks: [{ type: 'message', text }], parentToolUseId }
}

function tool(id: string, title: string, parentToolUseId?: string): ToolCallEntry {
  return { type: 'tool_call', toolCall: { id, title, status: 'running' }, parentToolUseId }
}

function ids(entries: ThreadEntry[]): string[] {
  return entries.map((entry) => (entry.type === 'tool_call' ? entry.toolCall.id : entry.id))
}

describe('buildThreadTree', () => {
  test('entries without a parent pointer stay top-level', () => {
    const entries: ThreadEntry[] = [assistant('a1', 'hello'), tool('call-1', 'Read')]
    const tree = buildThreadTree(entries)

    expect(ids(tree.top)).toEqual(['a1', 'call-1'])
    expect(tree.childrenByParent.size).toBe(0)
  })

  test('entries pointing at an Agent call move under it and keep their order', () => {
    const entries: ThreadEntry[] = [
      assistant('a1', 'start'),
      tool('toolu_agent', 'Agent'),
      tool('toolu_sub1', 'Read', 'toolu_agent'),
      assistant('a2', 'sub text', 'toolu_agent'),
      tool('toolu_sub2', 'Bash', 'toolu_agent'),
    ]
    const tree = buildThreadTree(entries)

    expect(ids(tree.top)).toEqual(['a1', 'toolu_agent'])
    expect(ids(tree.childrenByParent.get('toolu_agent') ?? [])).toEqual(['toolu_sub1', 'a2', 'toolu_sub2'])
  })

  test('an orphan child stays top-level so nothing disappears', () => {
    const entries: ThreadEntry[] = [assistant('a1', 'orphan', 'toolu_missing')]
    const tree = buildThreadTree(entries)

    expect(ids(tree.top)).toEqual(['a1'])
    expect(tree.childrenByParent.size).toBe(0)
  })

  test('nested agents key their own children separately', () => {
    const entries: ThreadEntry[] = [
      tool('toolu_agent', 'Agent'),
      tool('toolu_agent2', 'Agent', 'toolu_agent'),
      assistant('a1', 'deep', 'toolu_agent2'),
    ]
    const tree = buildThreadTree(entries)

    expect(ids(tree.top)).toEqual(['toolu_agent'])
    expect(ids(tree.childrenByParent.get('toolu_agent') ?? [])).toEqual(['toolu_agent2'])
    expect(ids(tree.childrenByParent.get('toolu_agent2') ?? [])).toEqual(['a1'])
  })

  test('a child pointer to a non-tool entry does not hide the child', () => {
    const entries: ThreadEntry[] = [assistant('a1', 'parent'), assistant('a2', 'child', 'a1')]
    const tree = buildThreadTree(entries)

    expect(ids(tree.top)).toEqual(['a1', 'a2'])
    expect(tree.childrenByParent.size).toBe(0)
  })
})
