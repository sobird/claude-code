import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { backgroundTaskViewModel } from '../background-task-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'TaskOutput', status: 'complete', ...overrides }
}

const SUCCESS_OUTPUT = [
  '<retrieval_status>success</retrieval_status>',
  '',
  '<task_id>bash_01</task_id>',
  '',
  '<task_type>local_bash</task_type>',
  '',
  '<status>completed</status>',
  '',
  '<exit_code>0</exit_code>',
  '',
  '<output>',
  'line one',
  'line two',
  '</output>',
].join('\n')

const STOPPED_OUTPUT = JSON.stringify({
  message: 'Successfully stopped task: bash_01 (bun run dev)',
  task_id: 'bash_01',
  task_type: 'local_bash',
  command: 'bun run dev',
})

describe('backgroundTaskViewModel', () => {
  test('parses a completed task output with exit code and body', () => {
    const model = backgroundTaskViewModel(tool({ rawOutput: { output: SUCCESS_OUTPUT } }))
    expect(model).toEqual({
      kind: 'output',
      taskId: 'bash_01',
      taskType: 'local_bash',
      status: 'completed',
      retrieval: 'success',
      exitCode: 0,
      output: 'line one\nline two',
      error: null,
    })
  })

  test('keeps a timeout with no task renderable', () => {
    const model = backgroundTaskViewModel(
      tool({ rawOutput: { output: '<retrieval_status>timeout</retrieval_status>' } }),
    )
    expect(model).toEqual({
      kind: 'output',
      taskId: null,
      taskType: null,
      status: null,
      retrieval: 'timeout',
      exitCode: null,
      output: null,
      error: null,
    })
  })

  test('reads a not-ready running task', () => {
    const output = [
      '<retrieval_status>not_ready</retrieval_status>',
      '',
      '<task_id>agent_9</task_id>',
      '',
      '<task_type>local_agent</task_type>',
      '',
      '<status>running</status>',
      '',
      '<output>',
      'partial',
      '</output>',
    ].join('\n')
    const model = backgroundTaskViewModel(tool({ rawOutput: { output } }))
    expect(model).toMatchObject({
      kind: 'output',
      taskId: 'agent_9',
      taskType: 'local_agent',
      status: 'running',
      retrieval: 'not_ready',
      output: 'partial',
    })
  })

  test('falls back to a message for a validation failure', () => {
    const model = backgroundTaskViewModel(
      tool({ status: 'error', rawOutput: { output: 'No task found with ID: bash_01' } }),
    )
    expect(model).toEqual({ kind: 'message', text: 'No task found with ID: bash_01' })
  })

  test('reads the id from the input while the task output is still running', () => {
    const model = backgroundTaskViewModel(tool({ status: 'running', rawInput: { task_id: 'bash_01', block: true } }))
    expect(model).toEqual({
      kind: 'output',
      taskId: 'bash_01',
      taskType: null,
      status: null,
      retrieval: null,
      exitCode: null,
      output: null,
      error: null,
    })
  })

  test('parses a successful stop', () => {
    const model = backgroundTaskViewModel(
      tool({ title: 'TaskStop', rawInput: { task_id: 'bash_01' }, rawOutput: { output: STOPPED_OUTPUT } }),
    )
    expect(model).toEqual({
      kind: 'stop',
      taskId: 'bash_01',
      taskType: 'local_bash',
      command: 'bun run dev',
      message: 'Successfully stopped task: bash_01 (bun run dev)',
      stopped: true,
    })
  })

  test('reports a stop rejected because the task already finished', () => {
    const model = backgroundTaskViewModel(
      tool({
        title: 'TaskStop',
        status: 'error',
        rawOutput: { output: 'Task bash_01 is not running (status: completed)' },
      }),
    )
    expect(model).toEqual({ kind: 'message', text: 'Task bash_01 is not running (status: completed)' })
  })

  test('reads the id from the input while the stop is still running', () => {
    const model = backgroundTaskViewModel(
      tool({ title: 'TaskStop', status: 'running', rawInput: { shell_id: 'bash_01' } }),
    )
    expect(model).toEqual({
      kind: 'stop',
      taskId: 'bash_01',
      taskType: null,
      command: null,
      message: null,
      stopped: false,
    })
  })

  test('treats legacy aliases like the canonical tools', () => {
    const outputAlias = backgroundTaskViewModel(
      tool({ title: 'AgentOutputTool', rawOutput: { output: SUCCESS_OUTPUT } }),
    )
    expect(outputAlias).toMatchObject({ kind: 'output', taskId: 'bash_01', exitCode: 0 })
    const stopAlias = backgroundTaskViewModel(tool({ title: 'KillShell', rawOutput: { output: STOPPED_OUTPUT } }))
    expect(stopAlias).toMatchObject({ kind: 'stop', taskId: 'bash_01', stopped: true })
  })

  test('falls back for other tools and empty calls', () => {
    expect(backgroundTaskViewModel(tool({ title: 'Bash', rawInput: { command: 'ls' } }))).toBeNull()
    expect(backgroundTaskViewModel(tool({ rawInput: {}, rawOutput: { output: '' } }))).toBeNull()
    expect(backgroundTaskViewModel(tool({ title: 'TaskStop', rawInput: {} }))).toBeNull()
  })
})
