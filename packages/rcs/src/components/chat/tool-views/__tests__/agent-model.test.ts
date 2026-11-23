import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { agentViewModel, formatDurationMs } from '../agent-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'Agent', status: 'complete', ...overrides }
}

const INPUT = {
  description: 'Investigate auth bug',
  subagent_type: 'Explore',
  prompt: 'Find the auth module and report entry points.',
}

describe('agentViewModel', () => {
  test('parses the usage trailer and strips it with the agentId line from the report', () => {
    const model = agentViewModel(
      tool({
        rawInput: INPUT,
        rawOutput: {
          output: `报告正文\n\nagentId: abc (use SendMessage with to: 'abc' to continue this agent)\n<usage>total_tokens: 1200\ntool_uses: 7\nduration_ms: 65000</usage>`,
        },
      }),
    )
    expect(model.output).toBe('报告正文')
    expect(model.usage).toEqual({ totalTokens: 1200, toolUses: 7, durationMs: 65000 })
    expect(model.launched).toBe(false)
    expect(model.description).toBe('Investigate auth bug')
    expect(model.subagentType).toBe('Explore')
    expect(model.prompt).toBe('Find the auth module and report entry points.')
    expect(model.errored).toBe(false)
  })

  test('strips worktree trailer lines as well', () => {
    const output = `Done.\nagentId: abc (use SendMessage with to: 'abc' to continue this agent)\nworktreePath: /tmp/wt\nworktreeBranch: agent/x\n<usage>total_tokens: 10\ntool_uses: 1\nduration_ms: 500</usage>`
    const model = agentViewModel(tool({ rawInput: INPUT, rawOutput: { output } }))
    expect(model.output).toBe('Done.')
    expect(model.usage).toEqual({ totalTokens: 10, toolUses: 1, durationMs: 500 })
  })

  test('leaves a one-shot result without a usage block untouched', () => {
    const output = 'Explored 12 files and found the entry point.'
    const model = agentViewModel(tool({ rawInput: INPUT, rawOutput: { output } }))
    expect(model.output).toBe(output)
    expect(model.usage).toBeNull()
  })

  test('flags an async launch and keeps its text', () => {
    const output = 'Async agent launched successfully.\nagentId: abc (internal ID - do not mention to user.)'
    const model = agentViewModel(tool({ status: 'running', rawInput: {}, rawOutput: { output } }))
    expect(model.launched).toBe(true)
    expect(model.usage).toBeNull()
    expect(model.output).toBe(output)
  })

  test('flags remote and teammate launches too', () => {
    const remote = 'Remote agent launched in CCR.\ntaskId: t-1'
    const teammate = 'Spawned successfully.\nagent_id: a-1'
    expect(agentViewModel(tool({ rawOutput: { output: remote } })).launched).toBe(true)
    expect(agentViewModel(tool({ rawOutput: { output: teammate } })).launched).toBe(true)
  })

  test('reads input fields tolerantly', () => {
    const model = agentViewModel(tool({ rawInput: { description: 42, subagent_type: '', prompt: 'x' } }))
    expect(model.description).toBeNull()
    expect(model.subagentType).toBeNull()
    expect(model.prompt).toBe('x')
  })

  test('falls back to serialized output when output is not a string', () => {
    const model = agentViewModel(tool({ rawOutput: { status: 'completed' } }))
    expect(model.output).toBe(JSON.stringify({ status: 'completed' }, null, 2))
    expect(model.usage).toBeNull()
  })

  test('handles a call with no result yet', () => {
    const model = agentViewModel(tool({ status: 'running', rawInput: INPUT }))
    expect(model.output).toBe('')
    expect(model.usage).toBeNull()
    expect(model.errored).toBe(false)
  })

  test('marks an errored call', () => {
    const model = agentViewModel(tool({ status: 'error', rawOutput: { output: 'boom' } }))
    expect(model.errored).toBe(true)
    expect(model.output).toBe('boom')
  })
})

describe('formatDurationMs', () => {
  test('formats sub-second, whole-second, and fractional durations', () => {
    expect(formatDurationMs(800)).toBe('800ms')
    expect(formatDurationMs(2000)).toBe('2s')
    expect(formatDurationMs(65000)).toBe('65s')
    expect(formatDurationMs(1500)).toBe('1.5s')
  })
})
