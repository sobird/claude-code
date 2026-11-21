import { describe, expect, test } from 'bun:test'

import {
  answerForQuestion,
  buildAskUserAnswers,
  emptyDrafts,
  isAskUserComplete,
  isAskUserQuestionRequest,
  parseAskUserQuestions,
  toggleOption,
  type AskUserQuestion,
} from '@/lib/ask-user-question'

const sampleQuestions: AskUserQuestion[] = [
  {
    question: 'Which genre?',
    header: 'Genre',
    multiSelect: false,
    options: [
      { label: 'Fantasy', description: 'Soft magic' },
      { label: 'Mystery', description: 'Twists' },
    ],
  },
  {
    question: 'Which extras?',
    header: 'Extras',
    multiSelect: true,
    options: [{ label: 'Tests' }, { label: 'Docs' }],
  },
]

describe('parseAskUserQuestions', () => {
  test('parses questions, options, and multiSelect flags', () => {
    const parsed = parseAskUserQuestions({
      questions: [
        {
          question: 'Pick one',
          header: 'Header',
          multiSelect: true,
          options: [{ label: 'A', description: 'first', preview: '<b>x</b>' }, { label: 'B' }],
        },
      ],
    })

    expect(parsed).toEqual([
      {
        question: 'Pick one',
        header: 'Header',
        multiSelect: true,
        options: [
          { label: 'A', description: 'first', preview: '<b>x</b>' },
          { label: 'B', description: undefined, preview: undefined },
        ],
      },
    ])
  })

  test('defaults multiSelect to false and drops entries without a question', () => {
    const parsed = parseAskUserQuestions({
      questions: [{ question: '', options: [{ label: 'A' }] }, { options: [{ label: 'B' }] }, { question: 'Kept' }],
    })

    expect(parsed).toEqual([{ question: 'Kept', header: undefined, multiSelect: false, options: [] }])
  })

  test('returns an empty list for malformed input', () => {
    expect(parseAskUserQuestions(undefined)).toEqual([])
    expect(parseAskUserQuestions({})).toEqual([])
    expect(parseAskUserQuestions({ questions: 'nope' })).toEqual([])
    expect(parseAskUserQuestions({ questions: [null, 3, 'x'] })).toEqual([])
  })
})

describe('isAskUserQuestionRequest', () => {
  test('recognizes the tool with a parsed question payload', () => {
    expect(isAskUserQuestionRequest('AskUserQuestion', { questions: [{ question: 'Q?' }] })).toBe(true)
  })

  test('rejects other tools, blank names, and empty question lists', () => {
    expect(isAskUserQuestionRequest('Bash', { questions: [{ question: 'Q?' }] })).toBe(false)
    expect(isAskUserQuestionRequest(undefined, { questions: [{ question: 'Q?' }] })).toBe(false)
    expect(isAskUserQuestionRequest('AskUserQuestion', { questions: [] })).toBe(false)
    expect(isAskUserQuestionRequest('AskUserQuestion', undefined)).toBe(false)
  })
})

describe('toggleOption', () => {
  test('single-select replaces the selection', () => {
    expect(toggleOption(['A'], 'B', false)).toEqual(['B'])
    expect(toggleOption([], 'A', false)).toEqual(['A'])
  })

  test('multi-select adds and removes labels', () => {
    expect(toggleOption(['A'], 'B', true)).toEqual(['A', 'B'])
    expect(toggleOption(['A', 'B'], 'A', true)).toEqual(['B'])
  })
})

describe('answerForQuestion', () => {
  test('joins multi-select labels and free text with commas', () => {
    expect(answerForQuestion({ selected: ['A', 'B'], other: '' })).toBe('A, B')
    expect(answerForQuestion({ selected: ['A'], other: ' custom ' })).toBe('A, custom')
  })

  test('uses the free text alone when nothing is selected', () => {
    expect(answerForQuestion({ selected: [], other: 'my answer' })).toBe('my answer')
    expect(answerForQuestion({ selected: [], other: '   ' })).toBe('')
  })
})

describe('buildAskUserAnswers', () => {
  test('keys answers by question text and skips unanswered questions', () => {
    expect(
      buildAskUserAnswers(sampleQuestions, {
        0: { selected: ['Fantasy'], other: '' },
        1: { selected: [], other: '' },
      }),
    ).toEqual({ 'Which genre?': 'Fantasy' })
  })

  test('comma-joins multi-select answers', () => {
    expect(
      buildAskUserAnswers(sampleQuestions, {
        0: { selected: [], other: 'Space opera' },
        1: { selected: ['Tests', 'Docs'], other: '' },
      }),
    ).toEqual({ 'Which genre?': 'Space opera', 'Which extras?': 'Tests, Docs' })
  })
})

describe('isAskUserComplete', () => {
  test('requires at least one question and an answer for every question', () => {
    const complete = emptyDrafts(sampleQuestions)
    expect(isAskUserComplete(sampleQuestions, complete)).toBe(false)

    complete[0] = { selected: ['Fantasy'], other: '' }
    complete[1] = { selected: ['Tests'], other: '' }
    expect(isAskUserComplete(sampleQuestions, complete)).toBe(true)
  })

  test('accepts free text as an answer', () => {
    expect(
      isAskUserComplete(sampleQuestions, {
        0: { selected: [], other: 'weird' },
        1: { selected: [], other: 'more' },
      }),
    ).toBe(true)
  })

  test('is false when there are no questions', () => {
    expect(isAskUserComplete([], {})).toBe(false)
  })
})
