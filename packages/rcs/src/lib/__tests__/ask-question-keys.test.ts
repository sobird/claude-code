import { describe, expect, test } from 'bun:test'

import { resolveAskQuestionKey } from '../ask-question-keys'

const base = {
  optionCount: 3,
  inEditable: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
}

describe('resolveAskQuestionKey', () => {
  test('digits select an option in range', () => {
    expect(resolveAskQuestionKey({ ...base, key: '1' })).toEqual({ action: 'select', index: 0 })
    expect(resolveAskQuestionKey({ ...base, key: '3' })).toEqual({ action: 'select', index: 2 })
  })

  test('digits beyond the option count are ignored', () => {
    expect(resolveAskQuestionKey({ ...base, key: '4' })).toEqual({ action: 'ignore' })
  })

  test('arrows move between questions and options', () => {
    expect(resolveAskQuestionKey({ ...base, key: 'ArrowLeft' })).toEqual({ action: 'prev-question' })
    expect(resolveAskQuestionKey({ ...base, key: 'ArrowRight' })).toEqual({ action: 'next-question' })
    expect(resolveAskQuestionKey({ ...base, key: 'ArrowUp' })).toEqual({ action: 'prev-option' })
    expect(resolveAskQuestionKey({ ...base, key: 'ArrowDown' })).toEqual({ action: 'next-option' })
  })

  test('Enter submits and Escape declines', () => {
    expect(resolveAskQuestionKey({ ...base, key: 'Enter' })).toEqual({ action: 'submit' })
    expect(resolveAskQuestionKey({ ...base, key: 'Escape' })).toEqual({ action: 'decline' })
  })

  test('ignores keys typed into editable targets and while composing', () => {
    expect(resolveAskQuestionKey({ ...base, key: '1', inEditable: true })).toEqual({ action: 'ignore' })
    expect(resolveAskQuestionKey({ ...base, key: 'Enter', inEditable: true })).toEqual({ action: 'ignore' })
    expect(resolveAskQuestionKey({ ...base, key: '1', isComposing: true })).toEqual({ action: 'ignore' })
  })

  test('ignores modified keys', () => {
    expect(resolveAskQuestionKey({ ...base, key: '1', ctrlKey: true })).toEqual({ action: 'ignore' })
    expect(resolveAskQuestionKey({ ...base, key: 'Enter', metaKey: true })).toEqual({ action: 'ignore' })
    expect(resolveAskQuestionKey({ ...base, key: 'ArrowDown', altKey: true })).toEqual({ action: 'ignore' })
  })

  test('ignores unrelated keys', () => {
    expect(resolveAskQuestionKey({ ...base, key: 'a' })).toEqual({ action: 'ignore' })
    expect(resolveAskQuestionKey({ ...base, key: 'Tab' })).toEqual({ action: 'ignore' })
  })
})
