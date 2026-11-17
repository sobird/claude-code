import { describe, expect, test } from 'bun:test'

import { earlierStartIndex, MESSAGE_WINDOW_SIZE, windowStartIndex } from '../message-window'

function keys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index}`)
}

describe('windowStartIndex', () => {
  test('starts at the tail window when nothing is pinned', () => {
    expect(windowStartIndex(keys(200), null)).toBe(200 - MESSAGE_WINDOW_SIZE)
    expect(windowStartIndex(keys(200), null, 50)).toBe(150)
  })

  test('starts at zero when the history is shorter than the window', () => {
    expect(windowStartIndex(keys(10), null, 50)).toBe(0)
    expect(windowStartIndex([], null, 50)).toBe(0)
  })

  test('keeps a pinned item in place as the list grows', () => {
    expect(windowStartIndex(keys(200), 'item-40', 50)).toBe(40)
  })

  test('follows a pinned item when older items are prepended', () => {
    const prepended = [...keys(20).map((key) => `old-${key}`), ...keys(200)]
    expect(windowStartIndex(prepended, 'item-40', 50)).toBe(60)
  })

  test('falls back to the tail window when the pinned item is gone', () => {
    expect(windowStartIndex(keys(200), 'missing', 50)).toBe(150)
  })

  test('treats a zero or negative window size as zero', () => {
    expect(windowStartIndex(keys(5), null, 0)).toBe(5)
    expect(windowStartIndex(keys(5), null, -10)).toBe(5)
  })
})

describe('earlierStartIndex', () => {
  test('steps back by one window', () => {
    expect(earlierStartIndex(200, 80)).toBe(120)
  })

  test('clamps at zero', () => {
    expect(earlierStartIndex(40, 80)).toBe(0)
    expect(earlierStartIndex(0, 80)).toBe(0)
  })

  test('treats a zero or negative step as no movement', () => {
    expect(earlierStartIndex(100, 0)).toBe(100)
    expect(earlierStartIndex(100, -5)).toBe(100)
  })
})
