import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { skillViewModel } from '../skill-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'Skill', status: 'complete', ...overrides }
}

describe('skillViewModel', () => {
  test('reads an inline skill and its arguments', () => {
    const model = skillViewModel(
      tool({ rawInput: { skill: 'commit', args: '-m "x"' }, rawOutput: { output: 'Launching skill: commit' } }),
    )
    expect(model).toEqual({ name: 'commit', args: '-m "x"', forked: false, result: null })
  })

  test('reads a forked result', () => {
    const output = 'Skill "review-pr" completed (forked execution).\n\nResult:\nLooks good.\nNo issues.'
    const model = skillViewModel(tool({ rawInput: { skill: 'review-pr' }, rawOutput: { output } }))
    expect(model).toEqual({
      name: 'review-pr',
      args: null,
      forked: true,
      result: 'Looks good.\nNo issues.',
    })
  })

  test('falls back to the name in the result text', () => {
    const model = skillViewModel(tool({ rawInput: {}, rawOutput: { output: 'Launching skill: pdf' } }))
    expect(model).toEqual({ name: 'pdf', args: null, forked: false, result: null })
  })

  test('reports nothing while the skill has not started', () => {
    expect(skillViewModel(tool({ status: 'running', rawInput: {} }))).toBeNull()
  })

  test('falls back for other tools', () => {
    expect(skillViewModel(tool({ title: 'Bash', rawInput: { command: 'ls' } }))).toBeNull()
  })
})
