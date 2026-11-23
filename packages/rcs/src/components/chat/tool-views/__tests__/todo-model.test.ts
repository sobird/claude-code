import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { todoViewModel } from '../todo-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'TodoWrite', status: 'complete', ...overrides }
}

describe('todoViewModel', () => {
  test('reads the todo list and progress', () => {
    const model = todoViewModel(
      tool({
        rawInput: {
          todos: [
            { content: 'Write tests', status: 'completed' },
            { content: 'Implement view', status: 'in_progress' },
            { content: 'Ship it', status: 'pending' },
          ],
        },
        rawOutput: { output: 'Todos updated' },
      }),
    )
    expect(model?.items.map((item) => [item.content, item.status])).toEqual([
      ['Write tests', 'completed'],
      ['Implement view', 'in_progress'],
      ['Ship it', 'pending'],
    ])
    expect(model?.done).toBe(1)
    expect(model?.total).toBe(3)
    expect(model?.output).toBe('Todos updated')
    expect(model?.errored).toBe(false)
  })

  test('accepts the subject field as the item text', () => {
    const model = todoViewModel(tool({ rawInput: { todos: [{ subject: 'Legacy shape', status: 'pending' }] } }))
    expect(model?.items[0]?.content).toBe('Legacy shape')
  })

  test('marks a failed call as errored', () => {
    const model = todoViewModel(
      tool({
        status: 'error',
        rawInput: { todos: [{ content: 'Broken', status: 'pending' }] },
        rawOutput: { output: 'Invalid todos' },
      }),
    )
    expect(model?.errored).toBe(true)
    expect(model?.output).toBe('Invalid todos')
  })

  test('diffs against the baseline list the reducer recorded', () => {
    const model = todoViewModel(
      tool({
        rawInput: {
          todos: [
            { content: 'Write tests', status: 'completed' },
            { content: 'Ship it', status: 'pending' },
          ],
        },
        baselineTodos: [
          { id: '0', content: 'Write tests', status: 'pending' },
          { id: '1', content: 'Review PR', status: 'pending' },
        ],
      }),
    )
    expect(model?.diff).toEqual({ added: ['Ship it'], removed: 1, completedDelta: 1, totalDelta: 0 })
  })

  test('diff is null without a baseline', () => {
    const model = todoViewModel(tool({ rawInput: { todos: [{ content: 'One', status: 'pending' }] } }))
    expect(model?.diff).toBeNull()
  })

  test('an unchanged list diffs to zeros', () => {
    const model = todoViewModel(
      tool({
        rawInput: { todos: [{ content: 'One', status: 'pending' }] },
        baselineTodos: [{ id: '0', content: 'One', status: 'pending' }],
      }),
    )
    expect(model?.diff).toEqual({ added: [], removed: 0, completedDelta: 0, totalDelta: 0 })
  })

  test('returns null when there are no todos to render', () => {
    expect(todoViewModel(tool({}))).toBeNull()
    expect(todoViewModel(tool({ rawInput: { todos: [] } }))).toBeNull()
    expect(todoViewModel(tool({ rawInput: { todos: [{ status: 'pending' }] } }))).toBeNull()
  })
})
