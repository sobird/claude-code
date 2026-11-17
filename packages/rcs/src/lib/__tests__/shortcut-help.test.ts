import { describe, expect, test } from 'bun:test'

import { isHelpShortcut } from '../shortcut-help'

describe('isHelpShortcut', () => {
  test('? outside an input opens help', () => {
    expect(isHelpShortcut({ key: '?', inEditable: false, hasModifier: false, isComposing: false })).toBe(true)
  })

  test('? typed into an input is just text', () => {
    expect(isHelpShortcut({ key: '?', inEditable: true, hasModifier: false, isComposing: false })).toBe(false)
  })

  test('modified keys are left alone', () => {
    expect(isHelpShortcut({ key: '?', inEditable: false, hasModifier: true, isComposing: false })).toBe(false)
  })

  test('IME composition is ignored', () => {
    expect(isHelpShortcut({ key: '?', inEditable: false, hasModifier: false, isComposing: true })).toBe(false)
  })

  test('other keys do not open help', () => {
    expect(isHelpShortcut({ key: 'Escape', inEditable: false, hasModifier: false, isComposing: false })).toBe(false)
  })
})
