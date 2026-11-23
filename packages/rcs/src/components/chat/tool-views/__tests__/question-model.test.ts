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

  test('derives per-option selection and free-text answers for the card', () => {
    const model = questionViewModel(
      tool({
        rawInput: QUESTIONS,
        rawOutput: { output: 'User has answered your questions: "Which approach?"="Registry, Something else".' },
      }),
    )
    const item = model?.items[0]
    expect(item?.multiSelect).toBe(false)
    expect(item?.options.map((option) => [option.label, option.selected])).toEqual([
      ['Registry', true],
      ['Switch', false],
    ])
    expect(item?.other).toEqual(['Something else'])
    expect(item?.answered).toBe(true)
  })

  test('keeps multiSelect on the derived item', () => {
    const model = questionViewModel(
      tool({
        rawInput: {
          questions: [
            {
              question: 'Pick any',
              multiSelect: true,
              options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
            },
          ],
        },
        rawOutput: { output: '"Pick any"="A, C"' },
      }),
    )
    expect(model?.items[0]?.multiSelect).toBe(true)
    expect(model?.items[0]?.options.filter((option) => option.selected).map((option) => option.label)).toEqual([
      'A',
      'C',
    ])
    expect(model?.items[0]?.other).toEqual([])
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
