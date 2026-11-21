import { describe, expect, test } from 'bun:test'

import { resolvePlanDialogKey } from '@/lib/plan-dialog-keys'

const base = { denyOpen: false }

describe('resolvePlanDialogKey', () => {
  test('a or Enter approves the plan', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'a' })).toBe('approve')
    expect(resolvePlanDialogKey({ ...base, key: 'A' })).toBe('approve')
    expect(resolvePlanDialogKey({ ...base, key: 'Enter' })).toBe('approve')
  })

  test('d opens the rejection form', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'd' })).toBe('deny')
    expect(resolvePlanDialogKey({ ...base, key: 'D' })).toBe('deny')
  })

  test('Escape is left to the dialog when no rejection form is open', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'Escape' })).toBeNull()
  })

  test('Escape closes an open rejection form', () => {
    expect(resolvePlanDialogKey({ ...base, denyOpen: true, key: 'Escape' })).toBe('closeDeny')
  })

  test('the rejection form swallows plain keys so feedback can be typed', () => {
    expect(resolvePlanDialogKey({ ...base, denyOpen: true, key: 'a' })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, denyOpen: true, key: 'Enter' })).toBeNull()
  })

  test('ignores keys typed into editable fields', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'a', inEditable: true })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, key: 'Enter', inEditable: true })).toBeNull()
  })

  test('ignores Enter while a button has focus so its click is not doubled', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'Enter', onButton: true })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, key: 'a', onButton: true })).toBeNull()
  })

  test('ignores modified keys and IME composition', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'a', hasModifier: true })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, key: 'd', hasModifier: true })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, key: 'a', isComposing: true })).toBeNull()
  })

  test('ignores unrelated keys', () => {
    expect(resolvePlanDialogKey({ ...base, key: 'x' })).toBeNull()
    expect(resolvePlanDialogKey({ ...base, key: 'ArrowDown' })).toBeNull()
  })
})
