import { describe, expect, test } from 'bun:test'

import { isSteerAllChord, resolveComposerKey, type ComposerKeyInput } from '@/lib/composer-keys'

function key(input: Partial<ComposerKeyInput>): ComposerKeyInput {
  return { key: 'Enter', shiftKey: false, queueModifier: false, isComposing: false, isLoading: false, ...input }
}

describe('resolveComposerKey', () => {
  test('Enter submits whether or not the agent is busy', () => {
    expect(resolveComposerKey(key({}))).toBe('submit')
    expect(resolveComposerKey(key({ isLoading: true }))).toBe('submit')
  })

  test('Cmd/Ctrl+Enter queues the message for the end of the turn', () => {
    expect(resolveComposerKey(key({ queueModifier: true }))).toBe('submit-queued')
    expect(resolveComposerKey(key({ queueModifier: true, isLoading: true }))).toBe('submit-queued')
  })

  test('Shift wins over the queue modifier so Cmd+Shift+Enter still newlines', () => {
    expect(resolveComposerKey(key({ queueModifier: true, shiftKey: true }))).toBe('newline')
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

describe('isSteerAllChord', () => {
  const base = {
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    metaKey: true,
    ctrlKey: false,
    hasDraft: false,
    enabled: true,
  }

  test('fires on an empty draft with Cmd or Ctrl+Enter', () => {
    expect(isSteerAllChord(base)).toBe(true)
    expect(isSteerAllChord({ ...base, metaKey: false, ctrlKey: true })).toBe(true)
  })

  test('yields to the queue-send binding while a draft or attachment exists', () => {
    expect(isSteerAllChord({ ...base, hasDraft: true })).toBe(false)
  })

  test('ignores Shift, Alt, other keys, and when disabled', () => {
    expect(isSteerAllChord({ ...base, shiftKey: true })).toBe(false)
    expect(isSteerAllChord({ ...base, altKey: true })).toBe(false)
    expect(isSteerAllChord({ ...base, key: 'a' })).toBe(false)
    expect(isSteerAllChord({ ...base, enabled: false })).toBe(false)
  })
})
