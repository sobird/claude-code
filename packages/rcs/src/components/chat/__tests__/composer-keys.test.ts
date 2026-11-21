import { describe, expect, test } from 'bun:test'

import { resolveComposerKey, type ComposerKeyInput } from '@/lib/composer-keys'

function key(input: Partial<ComposerKeyInput>): ComposerKeyInput {
  return { key: 'Enter', shiftKey: false, isComposing: false, isLoading: false, ...input }
}

describe('resolveComposerKey', () => {
  test('Enter submits whether or not the agent is busy', () => {
    expect(resolveComposerKey(key({}))).toBe('submit')
    expect(resolveComposerKey(key({ isLoading: true }))).toBe('submit')
  })

  test('Shift+Enter inserts a newline instead of submitting', () => {
    expect(resolveComposerKey(key({ shiftKey: true }))).toBe('newline')
    expect(resolveComposerKey(key({ shiftKey: true, isLoading: true }))).toBe('newline')
  })

  test('Escape interrupts only while the agent is running', () => {
    expect(resolveComposerKey(key({ key: 'Escape', isLoading: true }))).toBe('interrupt')
    expect(resolveComposerKey(key({ key: 'Escape', isLoading: false }))).toBe('ignore')
  })

  test('keys pressed mid-composition are ignored so IME works', () => {
    expect(resolveComposerKey(key({ isComposing: true }))).toBe('ignore')
    expect(resolveComposerKey(key({ key: 'Escape', isLoading: true, isComposing: true }))).toBe('ignore')
  })

  test('unrelated keys are ignored', () => {
    expect(resolveComposerKey(key({ key: 'a' }))).toBe('ignore')
  })
})
