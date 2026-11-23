import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { taskViewModel } from '../task-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'TaskCreate', status: 'complete', ...overrides }
}

describe('taskViewModel', () => {
  test('reads a created task and the id from the result text', () => {
    const model = taskViewModel(
      tool({
        rawInput: { subject: 'Ship it', description: 'Cut the release', activeForm: 'Shipping' },
        rawOutput: { output: 'Task #7 created successfully: Ship it' },
      }),
    )
    expect(model).toEqual({
      kind: 'create',
      subject: 'Ship it',
      description: 'Cut the release',
      activeForm: 'Shipping',
      taskId: '7',
    })
  })

  test('reports no id for a create that has not returned yet', () => {
    const model = taskViewModel(tool({ status: 'running', rawInput: { subject: 'Ship it' } }))
    expect(model).toEqual({ kind: 'create', subject: 'Ship it', description: null, activeForm: null, taskId: null })
  })

  test('reads an update with its fields, status, owner, and links', () => {
    const model = taskViewModel(
      tool({
        title: 'TaskUpdate',
        rawInput: { taskId: '7', status: 'in_progress', owner: 'alice', addBlocks: ['9'], addBlockedBy: ['3'] },
        rawOutput: { output: 'Updated task #7 status, owner' },
      }),
    )
    expect(model).toEqual({
      kind: 'update',
      taskId: '7',
      fields: ['status', 'owner'],
      status: 'in_progress',
      owner: 'alice',
      blocks: ['9'],
      blockedBy: ['3'],
      notFound: false,
    })
  })

  test('flags an update whose task is gone', () => {
    const model = taskViewModel(
      tool({ title: 'TaskUpdate', rawInput: { taskId: '7' }, rawOutput: { output: 'Task #7 not found' } }),
    )
    expect(model).toMatchObject({ kind: 'update', taskId: '7', fields: [], notFound: true })
  })

  test('reads an update that has not returned yet', () => {
    const model = taskViewModel(
      tool({ title: 'TaskUpdate', status: 'running', rawInput: { taskId: '7', status: 'completed' } }),
    )
    expect(model).toMatchObject({ kind: 'update', fields: [], notFound: false, status: 'completed' })
  })

  test('parses the task list with owners and blockers', () => {
    const output = [
      '#1 [completed] Write docs (alice)',
      '#2 [in_progress] Ship it (bob) [blocked by #1, #3]',
      '#3 [pending] Verify',
    ].join('\n')
    const model = taskViewModel(tool({ title: 'TaskList', rawInput: {}, rawOutput: { output } }))
    expect(model).toEqual({
      kind: 'list',
      empty: false,
      tasks: [
        { id: '1', subject: 'Write docs', status: 'completed', owner: 'alice', blockedBy: [] },
        { id: '2', subject: 'Ship it', status: 'in_progress', owner: 'bob', blockedBy: ['1', '3'] },
        { id: '3', subject: 'Verify', status: 'pending', owner: null, blockedBy: [] },
      ],
    })
  })

  test('treats an empty listing as empty', () => {
    const model = taskViewModel(tool({ title: 'TaskList', rawInput: {}, rawOutput: { output: 'No tasks found' } }))
    expect(model).toEqual({ kind: 'list', tasks: [], empty: true })
  })

  test('parses a task detail', () => {
    const output = [
      'Task #7: Ship it',
      'Status: in_progress',
      'Description: Cut the release',
      'Blocked by: #3, #4',
      'Blocks: #9',
    ].join('\n')
    const model = taskViewModel(tool({ title: 'TaskGet', rawInput: { taskId: '7' }, rawOutput: { output } }))
    expect(model).toEqual({
      kind: 'get',
      task: {
        id: '7',
        subject: 'Ship it',
        status: 'in_progress',
        description: 'Cut the release',
        blocks: ['9'],
        blockedBy: ['3', '4'],
      },
    })
  })

  test('reports a missing task detail', () => {
    const model = taskViewModel(
      tool({ title: 'TaskGet', rawInput: { taskId: '7' }, rawOutput: { output: 'Task not found' } }),
    )
    expect(model).toEqual({ kind: 'get', task: null })
  })

  test('falls back for unregistered names and empty input without output', () => {
    expect(taskViewModel(tool({ title: 'Bash', rawInput: { command: 'ls' } }))).toBeNull()
    expect(taskViewModel(tool({ rawInput: {} }))).toBeNull()
    expect(taskViewModel(tool({ title: 'TaskUpdate', rawInput: {} }))).toBeNull()
    expect(taskViewModel(tool({ title: 'TaskList', rawInput: {} }))).toBeNull()
    expect(taskViewModel(tool({ title: 'TaskGet', rawInput: { taskId: '7' } }))).toBeNull()
  })
})
