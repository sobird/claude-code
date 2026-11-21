import { describe, expect, test } from 'bun:test'

import { resolvePermissionKey, type PermissionKeyInput } from '@/lib/permission-keys'

function input(overrides: Partial<PermissionKeyInput>): PermissionKeyInput {
  return { key: 'a', requestCount: 1, selectedIndex: 0, inEditable: false, ...overrides }
}

describe('resolvePermissionKey', () => {
  test('a allows the selected request, defaulting to the first', () => {
    expect(resolvePermissionKey(input({ key: 'a' }))).toEqual({ action: 'allow', index: 0 })
    expect(resolvePermissionKey(input({ key: 'A', selectedIndex: 1, requestCount: 2 }))).toEqual({
      action: 'allow',
      index: 1,
    })
    expect(resolvePermissionKey(input({ key: 'a', selectedIndex: null }))).toEqual({ action: 'allow', index: 0 })
  })

  test('d denies the selected request', () => {
    expect(resolvePermissionKey(input({ key: 'd', selectedIndex: 1, requestCount: 2 }))).toEqual({
      action: 'deny',
      index: 1,
    })
  })

  test('digits select a request by position', () => {
    expect(resolvePermissionKey(input({ key: '2', requestCount: 3 }))).toEqual({ action: 'select', index: 1 })
    expect(resolvePermissionKey(input({ key: '3', requestCount: 2 }))).toEqual({ action: 'ignore' })
    expect(resolvePermissionKey(input({ key: '0', requestCount: 2 }))).toEqual({ action: 'ignore' })
  })

  test('arrows and j/k move the selection', () => {
    expect(resolvePermissionKey(input({ key: 'ArrowDown' }))).toEqual({ action: 'next' })
    expect(resolvePermissionKey(input({ key: 'j' }))).toEqual({ action: 'next' })
    expect(resolvePermissionKey(input({ key: 'ArrowUp' }))).toEqual({ action: 'previous' })
    expect(resolvePermissionKey(input({ key: 'k' }))).toEqual({ action: 'previous' })
  })

  test('Enter allows the selected request', () => {
    expect(resolvePermissionKey(input({ key: 'Enter' }))).toEqual({ action: 'allow', index: 0 })
  })

  test('Escape is left to the composer', () => {
    expect(resolvePermissionKey(input({ key: 'Escape' }))).toEqual({ action: 'ignore' })
  })

  test('keys pressed in an editable element are ignored', () => {
    expect(resolvePermissionKey(input({ key: 'a', inEditable: true }))).toEqual({ action: 'ignore' })
    expect(resolvePermissionKey(input({ key: 'Enter', inEditable: true }))).toEqual({ action: 'ignore' })
  })

  test('modifier combinations are ignored', () => {
    expect(resolvePermissionKey(input({ key: 'a', ctrlKey: true }))).toEqual({ action: 'ignore' })
    expect(resolvePermissionKey(input({ key: 'd', metaKey: true }))).toEqual({ action: 'ignore' })
    expect(resolvePermissionKey(input({ key: 'Enter', altKey: true }))).toEqual({ action: 'ignore' })
  })

  test('IME composition is ignored', () => {
    expect(resolvePermissionKey(input({ key: 'a', isComposing: true }))).toEqual({ action: 'ignore' })
  })

  test('nothing happens without pending requests', () => {
    expect(resolvePermissionKey(input({ key: 'a', requestCount: 0 }))).toEqual({ action: 'ignore' })
    expect(resolvePermissionKey(input({ key: 'Enter', requestCount: 0 }))).toEqual({ action: 'ignore' })
  })

  test('a stale selection clamps to the last request', () => {
    expect(resolvePermissionKey(input({ key: 'a', requestCount: 2, selectedIndex: 5 }))).toEqual({
      action: 'allow',
      index: 1,
    })
  })
})
