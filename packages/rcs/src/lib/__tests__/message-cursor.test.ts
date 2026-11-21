import { describe, expect, test } from 'bun:test'

import { type CursorItem, latestUserKey, moveCursorKey, navigableItems, resolveCursorKey } from '@/lib/message-cursor'

const items: CursorItem[] = [
  { key: 'u1', kind: 'user' },
  { key: 'a1', kind: 'assistant' },
  { key: 't1', kind: 'tools' },
  { key: 'e1', kind: 'turn_end' },
  { key: 'u2', kind: 'user' },
  { key: 'a2', kind: 'assistant' },
  { key: 'e2', kind: 'turn_end' },
]

function idle(overrides: Partial<Parameters<typeof resolveCursorKey>[0]> = {}) {
  return resolveCursorKey({
    key: '',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    cursorActive: true,
    ...overrides,
  })
}

describe('navigableItems', () => {
  test('drops turn markers', () => {
    expect(navigableItems(items).map((item) => item.key)).toEqual(['u1', 'a1', 't1', 'u2', 'a2'])
  })
})

describe('latestUserKey', () => {
  test('prefers the newest user message', () => {
    expect(latestUserKey(items)).toBe('u2')
  })

  test('falls back to the last navigable item without user messages', () => {
    expect(
      latestUserKey([
        { key: 'a1', kind: 'assistant' },
        { key: 'e1', kind: 'turn_end' },
      ]),
    ).toBe('a1')
  })

  test('returns null for an empty or marker-only list', () => {
    expect(latestUserKey([])).toBeNull()
    expect(latestUserKey([{ key: 'e1', kind: 'turn_end' }])).toBeNull()
  })
})

describe('moveCursorKey', () => {
  test('prev/next walk the navigable list and clamp at the ends', () => {
    expect(moveCursorKey(items, 'a1', 'prev')).toBe('u1')
    expect(moveCursorKey(items, 'u1', 'prev')).toBe('u1')
    expect(moveCursorKey(items, 'a1', 'next')).toBe('t1')
    expect(moveCursorKey(items, 'a2', 'next')).toBe('a2')
  })

  test('skips turn markers when stepping', () => {
    expect(moveCursorKey(items, 't1', 'next')).toBe('u2')
    expect(moveCursorKey(items, 'u2', 'prev')).toBe('t1')
  })

  test('user-prev/user-next hop between user messages', () => {
    expect(moveCursorKey(items, 'a1', 'user-prev')).toBe('u1')
    expect(moveCursorKey(items, 'a1', 'user-next')).toBe('u2')
    expect(moveCursorKey(items, 'u1', 'user-prev')).toBe('u1')
    expect(moveCursorKey(items, 'u2', 'user-next')).toBe('u2')
  })

  test('top/bottom jump to the first and last navigable item', () => {
    expect(moveCursorKey(items, 'a1', 'top')).toBe('u1')
    expect(moveCursorKey(items, 'u1', 'bottom')).toBe('a2')
  })

  test('a stale or missing cursor lands on a valid item', () => {
    expect(moveCursorKey(items, null, 'prev')).toBe('u1')
    expect(moveCursorKey(items, 'gone', 'next')).toBe('u1')
    expect(moveCursorKey(items, 'gone', 'top')).toBe('u1')
    expect(moveCursorKey(items, 'gone', 'bottom')).toBe('a2')
  })

  test('an empty list stays null', () => {
    expect(moveCursorKey([], null, 'next')).toBeNull()
  })
})

describe('resolveCursorKey', () => {
  test('shift+up enters the cursor when inactive', () => {
    expect(idle({ key: 'ArrowUp', shiftKey: true, cursorActive: false })).toEqual({ action: 'enter-cursor' })
  })

  test('plain keys are ignored while inactive', () => {
    expect(idle({ key: 'ArrowUp', cursorActive: false })).toEqual({ action: 'ignore' })
    expect(idle({ key: 'c', cursorActive: false })).toEqual({ action: 'ignore' })
    expect(idle({ key: 'Enter', cursorActive: false })).toEqual({ action: 'ignore' })
  })

  test('arrows and j/k move while active', () => {
    expect(idle({ key: 'ArrowUp' })).toEqual({ action: 'move', move: 'prev' })
    expect(idle({ key: 'k' })).toEqual({ action: 'move', move: 'prev' })
    expect(idle({ key: 'ArrowDown' })).toEqual({ action: 'move', move: 'next' })
    expect(idle({ key: 'j' })).toEqual({ action: 'move', move: 'next' })
  })

  test('shift+arrows hop between user messages', () => {
    expect(idle({ key: 'ArrowUp', shiftKey: true })).toEqual({ action: 'move', move: 'user-prev' })
    expect(idle({ key: 'ArrowDown', shiftKey: true })).toEqual({ action: 'move', move: 'user-next' })
  })

  test('cmd+arrows jump to the ends', () => {
    expect(idle({ key: 'ArrowUp', metaKey: true })).toEqual({ action: 'move', move: 'top' })
    expect(idle({ key: 'ArrowDown', metaKey: true })).toEqual({ action: 'move', move: 'bottom' })
  })

  test('enter, c, and p map to their actions', () => {
    expect(idle({ key: 'Enter' })).toEqual({ action: 'enter' })
    expect(idle({ key: 'c' })).toEqual({ action: 'copy' })
    expect(idle({ key: 'p' })).toEqual({ action: 'copy-primary' })
  })

  test('escape and ctrl+c exit', () => {
    expect(idle({ key: 'Escape' })).toEqual({ action: 'exit' })
    expect(idle({ key: 'c', ctrlKey: true })).toEqual({ action: 'exit' })
  })

  test('IME composition and alt-modified keys are ignored', () => {
    expect(idle({ key: 'Enter', isComposing: true })).toEqual({ action: 'ignore' })
    expect(idle({ key: 'c', altKey: true })).toEqual({ action: 'ignore' })
  })

  test('unrelated keys and modified shortcuts are ignored', () => {
    expect(idle({ key: 'x' })).toEqual({ action: 'ignore' })
    expect(idle({ key: 'c', metaKey: true })).toEqual({ action: 'ignore' })
    expect(idle({ key: 'j', ctrlKey: true })).toEqual({ action: 'ignore' })
  })
})
