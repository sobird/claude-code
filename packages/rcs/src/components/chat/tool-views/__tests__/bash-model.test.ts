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
      exitCode: null,
      background: false,
      timeout: null,
    })
  })

  test('flags a run_in_background call', () => {
    const model = bashViewModel(
      tool({
        rawInput: { command: 'npm run dev', run_in_background: true },
        rawOutput: {
          output: 'Command running in background with ID: b7k2. Output is being written to: /tmp/tasks/b7k2.output',
        },
      }),
    )
    expect(model?.background).toBe(true)
  })

  test('flags a command the CLI backgrounded on its own', () => {
    const model = bashViewModel(
      tool({
        rawInput: { command: 'npm test' },
        rawOutput: {
          output:
            'Command exceeded the assistant-mode blocking budget (120s) and was moved to the background with ID: q1w2.',
        },
      }),
    )
    expect(model?.background).toBe(true)
  })

  test('reads the timeout hint the CLI prepends to stderr', () => {
    const model = bashViewModel(
      tool({
        status: 'error',
        rawInput: { command: 'sleep 100', timeout: 2000 },
        rawOutput: { output: 'Exit code 1\nCommand timed out after 2s\nkilled' },
      }),
    )
    expect(model?.timeout).toBe('2s')
  })

  test('timeout stays null for a plain failure', () => {
    const model = bashViewModel(
      tool({ status: 'error', rawInput: { command: 'false' }, rawOutput: { output: 'Exit code 1' } }),
    )
    expect(model?.timeout).toBeNull()
  })

  test('reads the exit code the CLI appends to failed output', () => {
    const model = bashViewModel(
      tool({ status: 'error', rawInput: { command: 'false' }, rawOutput: { output: 'boom\nExit code 2' } }),
    )
    expect(model?.exitCode).toBe(2)
    expect(model?.errored).toBe(true)
  })

  test('ignores exit-code-looking text when it is not its own line', () => {
    const model = bashViewModel(
      tool({ rawInput: { command: 'echo hi' }, rawOutput: { output: 'Exit code documentation' } }),
    )
    expect(model?.exitCode).toBeNull()
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
