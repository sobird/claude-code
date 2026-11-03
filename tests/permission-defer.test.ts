import { expect, test } from 'bun:test'

import { shouldDeferPermission } from '../src/services/tools/permissionDefer'
import { resolvePermissionBehavior } from '../src/utils/hooks.js'

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

test('defer beats ask regardless of order', () => {
  expect(resolvePermissionBehavior(undefined, 'defer')).toBe('defer')
  expect(resolvePermissionBehavior('defer', 'ask')).toBe('defer')
  expect(resolvePermissionBehavior('ask', 'defer')).toBe('defer')
})

test('defer beats allow regardless of order', () => {
  expect(resolvePermissionBehavior('defer', 'allow')).toBe('defer')
  expect(resolvePermissionBehavior('allow', 'defer')).toBe('defer')
})

test('deny beats defer regardless of order', () => {
  expect(resolvePermissionBehavior('defer', 'deny')).toBe('deny')
  expect(resolvePermissionBehavior('deny', 'defer')).toBe('deny')
})

test('ask beats allow but not a set defer', () => {
  expect(resolvePermissionBehavior('ask', 'allow')).toBe('ask')
  expect(resolvePermissionBehavior('allow', 'ask')).toBe('ask')
  expect(resolvePermissionBehavior(undefined, 'allow')).toBe('allow')
})

test('passthrough is a no-op', () => {
  expect(resolvePermissionBehavior(undefined, 'passthrough')).toBeUndefined()
  expect(resolvePermissionBehavior('allow', 'passthrough')).toBe('allow')
  expect(resolvePermissionBehavior('defer', 'passthrough')).toBe('defer')
  expect(resolvePermissionBehavior('deny', 'passthrough')).toBe('deny')
})
