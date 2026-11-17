import { describe, expect, test } from 'bun:test'

import { resolveEditKey } from '../composer-keys'

describe('resolveEditKey', () => {
  test('Enter submits', () => {
    expect(resolveEditKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe('submit')
  })

  test('Shift+Enter inserts a newline', () => {
    expect(resolveEditKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe('newline')
  })

  test('Escape cancels the edit', () => {
    expect(resolveEditKey({ key: 'Escape', shiftKey: false, isComposing: false })).toBe('cancel')
  })

  test('keys from an IME composition are ignored', () => {
    expect(resolveEditKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe('ignore')
    expect(resolveEditKey({ key: 'Escape', shiftKey: false, isComposing: true })).toBe('ignore')
  })
})
