import { describe, expect, test } from 'bun:test'

import { withPendingApprovalCount } from '@/lib/approval-alert'

describe('withPendingApprovalCount', () => {
  test('returns the title unchanged when nothing is pending', () => {
    expect(withPendingApprovalCount('Remote Control', 0)).toBe('Remote Control')
  })

  test('prefixes the pending count', () => {
    expect(withPendingApprovalCount('Remote Control', 1)).toBe('(1) Remote Control')
    expect(withPendingApprovalCount('Remote Control', 3)).toBe('(3) Remote Control')
  })

  test('ignores negative counts', () => {
    expect(withPendingApprovalCount('Remote Control', -1)).toBe('Remote Control')
  })
})
