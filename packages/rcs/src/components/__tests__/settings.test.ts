import { describe, expect, test } from 'bun:test'

import { MIN_PASSWORD_LENGTH, canManageUsers, maskApiKey, validatePasswordChange } from '../settings/settings-utils'

describe('maskApiKey', () => {
  test('keeps the rcs_ prefix visible and appends an ellipsis', () => {
    expect(maskApiKey('rcs_abcd')).toBe('rcs_abcd\u2026')
  })

  test('truncates overlong prefixes', () => {
    const masked = maskApiKey('rcs_abcdefghijklmnop')
    expect(masked).toBe('rcs_abcdefgh\u2026')
  })

  test('handles empty and whitespace-only input safely', () => {
    expect(maskApiKey('')).toBe('')
    expect(maskApiKey('   ')).toBe('')
  })
})

describe('validatePasswordChange', () => {
  test('accepts a valid change', () => {
    expect(validatePasswordChange({ current: 'old', next: 'new-password', confirm: 'new-password' })).toBeNull()
  })

  test('rejects missing fields', () => {
    expect(validatePasswordChange({ current: '', next: 'new-password', confirm: 'new-password' })).toBe('fill_all')
  })

  test('rejects a short new password', () => {
    expect(
      validatePasswordChange({
        current: 'old',
        next: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
        confirm: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
      }),
    ).toBe('too_short')
  })

  test('rejects mismatched confirmation', () => {
    expect(validatePasswordChange({ current: 'old', next: 'new', confirm: 'other' })).toBe('mismatch')
  })

  test('rejects reusing the current password', () => {
    expect(validatePasswordChange({ current: 'same', next: 'same', confirm: 'same' })).toBe('same_as_current')
  })
})

describe('canManageUsers', () => {
  test('is true only for admins', () => {
    expect(canManageUsers({ role: 'admin' })).toBe(true)
    expect(canManageUsers({ role: 'member' })).toBe(false)
    expect(canManageUsers({ role: null })).toBe(false)
    expect(canManageUsers(null)).toBe(false)
    expect(canManageUsers(undefined)).toBe(false)
  })
})
