import { expect, test } from 'bun:test'

import { shouldDeferPermission } from '../src/services/tools/permissionDefer'

test('defer only in print mode with a solo tool call', () => {
  expect(shouldDeferPermission({ isNonInteractive: true, permissionBehavior: 'defer', toolUseCountInBatch: 1 })).toBe(
    true,
  )
  expect(shouldDeferPermission({ isNonInteractive: false, permissionBehavior: 'defer', toolUseCountInBatch: 1 })).toBe(
    false,
  )
  expect(shouldDeferPermission({ isNonInteractive: true, permissionBehavior: 'defer', toolUseCountInBatch: 2 })).toBe(
    false,
  )
  expect(shouldDeferPermission({ isNonInteractive: true, permissionBehavior: 'allow', toolUseCountInBatch: 1 })).toBe(
    false,
  )
})
