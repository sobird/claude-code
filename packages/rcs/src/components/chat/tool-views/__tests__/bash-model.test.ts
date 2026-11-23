import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { bashViewModel } from '../bash-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'Bash', status: 'complete', ...overrides }
}

describe('bashViewModel', () => {
  test('extracts the command, description, and output', () => {
    const model = bashViewModel(
      tool({
        rawInput: { command: 'ls -la', description: 'List files' },
        rawOutput: { output: 'a.txt\nb.txt' },
      }),
    )
    expect(model).toEqual({
      command: 'ls -la',
      description: 'List files',
      output: 'a.txt\nb.txt',
      errored: false,
    })
  })

  test('marks a failed call as errored', () => {
    const model = bashViewModel(
      tool({ status: 'error', rawInput: { command: 'false' }, rawOutput: { output: 'boom' } }),
    )
    expect(model?.errored).toBe(true)
  })

  test('returns null when the command is missing', () => {
    expect(bashViewModel(tool({ rawInput: { description: 'no command' } }))).toBeNull()
    expect(bashViewModel(tool({}))).toBeNull()
  })
})
