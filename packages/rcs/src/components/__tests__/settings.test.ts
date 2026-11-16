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
    expect(
      validatePasswordChange({ current: 'old-password', next: 'new-password', confirm: 'new-password' }),
    ).toBeNull()
  })

  test('rejects missing fields', () => {
    expect(validatePasswordChange({ current: '', next: 'new-password', confirm: 'new-password' })).toBe(
      'Fill in all password fields.',
    )
    expect(validatePasswordChange({ current: 'old-password', next: '', confirm: '' })).toBe(
      'Fill in all password fields.',
    )
  })

  test('rejects a short new password', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(validatePasswordChange({ current: 'old-password', next: short, confirm: short })).toBe(
      `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  })

  test('rejects mismatched confirmation', () => {
    expect(validatePasswordChange({ current: 'old-password', next: 'new-password', confirm: 'other-password' })).toBe(
      'New passwords do not match.',
    )
  })

  test('rejects reusing the current password', () => {
    expect(validatePasswordChange({ current: 'same-password', next: 'same-password', confirm: 'same-password' })).toBe(
      'New password must differ from the current password.',
    )
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
