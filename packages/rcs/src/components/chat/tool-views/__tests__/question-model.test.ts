import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { questionViewModel } from '../question-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'AskUserQuestion', status: 'complete', ...overrides }
}

const QUESTIONS = {
  questions: [
    {
      question: 'Which approach?',
      header: 'Approach',
      multiSelect: false,
      options: [
        { label: 'Registry', description: 'Keyed lookup' },
        { label: 'Switch', description: 'Inline branch' },
      ],
    },
  ],
}

describe('questionViewModel', () => {
  test('reads the questions and the answers parsed from the result text', () => {
    const model = questionViewModel(
      tool({
        rawInput: QUESTIONS,
        rawOutput: {
          output:
            'User has answered your questions: "Which approach?"="Registry". You can now continue with the user\'s answers in mind.',
        },
      }),
    )
    expect(model?.questions[0]?.question).toBe('Which approach?')
    expect(model?.questions[0]?.options.map((option) => option.label)).toEqual(['Registry', 'Switch'])
    expect(model?.answers).toEqual({ 'Which approach?': 'Registry' })
    expect(model?.answered).toBe(true)
  })

  test('stays unanswered while the prompt is still open', () => {
    const model = questionViewModel(tool({ status: 'waiting_for_confirmation', rawInput: QUESTIONS }))
    expect(model?.answered).toBe(false)
    expect(model?.answers).toEqual({})
  })

  test('splits multi-select answers on the comma join', () => {
    const model = questionViewModel(
      tool({
        rawInput: QUESTIONS,
        rawOutput: { output: 'User has answered your questions: "Which approach?"="Registry, Switch".' },
      }),
    )
    expect(model?.answers['Which approach?']).toBe('Registry, Switch')
  })

  test('marks a failed call as errored', () => {
    const model = questionViewModel(
      tool({ status: 'error', rawInput: QUESTIONS, rawOutput: { output: 'User declined to answer' } }),
    )
    expect(model?.errored).toBe(true)
    expect(model?.answered).toBe(false)
  })

  test('returns null when no questions parse', () => {
    expect(questionViewModel(tool({}))).toBeNull()
    expect(questionViewModel(tool({ rawInput: { questions: [{ options: [] }] } }))).toBeNull()
  })
})
