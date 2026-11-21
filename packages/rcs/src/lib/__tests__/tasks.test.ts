import { describe, expect, test } from 'bun:test'

import { shouldShowTaskPanel, taskProgress, tasksFromTaskState, tasksFromTodoWrite } from '@/lib/tasks'

describe('tasksFromTodoWrite', () => {
  test('maps TodoWrite todos onto tasks', () => {
    expect(
      tasksFromTodoWrite({
        todos: [
          { content: 'Add tests', status: 'in_progress', activeForm: 'Adding tests' },
          { content: 'Ship it', status: 'completed' },
        ],
      }),
    ).toEqual([
      { id: '0', content: 'Add tests', status: 'in_progress', activeForm: 'Adding tests' },
      { id: '1', content: 'Ship it', status: 'completed', activeForm: undefined },
    ])
  })

  test('an empty list clears the panel', () => {
    expect(tasksFromTodoWrite({ todos: [] })).toEqual([])
  })

  test('ignores payloads that are not a todo array', () => {
    expect(tasksFromTodoWrite({})).toBeNull()
    expect(tasksFromTodoWrite({ todos: 'nope' })).toBeNull()
    expect(tasksFromTodoWrite(null)).toBeNull()
  })

  test('drops entries without content and normalizes status', () => {
    expect(
      tasksFromTodoWrite({
        todos: [
          { content: '  ', status: 'pending' },
          { content: 'Real', status: 'surprise' },
          { subject: 'From subject', status: 'pending' },
        ],
      }),
    ).toEqual([
      { id: '1', content: 'Real', status: 'pending', activeForm: undefined },
      { id: '2', content: 'From subject', status: 'pending', activeForm: undefined },
    ])
  })
})

describe('tasksFromTaskState', () => {
  test('maps task_state tasks and falls back to subject', () => {
    expect(
      tasksFromTaskState({
        tasks: [
          { id: 't1', subject: 'Investigate', status: 'in_progress' },
          { id: 't2', content: 'Fix', status: 'completed' },
        ],
      }),
    ).toEqual([
      { id: 't1', content: 'Investigate', status: 'in_progress', activeForm: undefined },
      { id: 't2', content: 'Fix', status: 'completed', activeForm: undefined },
    ])
  })

  test('skips entries with unknown statuses', () => {
    expect(
      tasksFromTaskState({
        tasks: [{ id: 't1', subject: 'Gone', status: 'deleted' }],
      }),
    ).toEqual([])
  })

  test('ignores payloads without a tasks array', () => {
    expect(tasksFromTaskState({})).toBeNull()
  })
})

describe('taskProgress / shouldShowTaskPanel', () => {
  test('counts completed tasks', () => {
    expect(
      taskProgress([
        { id: '0', content: 'a', status: 'completed' },
        { id: '1', content: 'b', status: 'in_progress' },
        { id: '2', content: 'c', status: 'pending' },
      ]),
    ).toEqual({ done: 1, total: 3 })
  })

  test('hides the panel when there is nothing to show', () => {
    expect(shouldShowTaskPanel([])).toBe(false)
    expect(shouldShowTaskPanel([{ id: '0', content: 'a', status: 'completed' }])).toBe(false)
    expect(shouldShowTaskPanel([{ id: '0', content: 'a', status: 'pending' }])).toBe(true)
    expect(shouldShowTaskPanel([{ id: '0', content: 'a', status: 'in_progress' }])).toBe(true)
  })
})
