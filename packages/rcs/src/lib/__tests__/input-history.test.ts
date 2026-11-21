import { describe, expect, test } from 'bun:test'

import { appendHistory, moveHistory } from '@/lib/input-history'

describe('appendHistory', () => {
  test('appends a trimmed prompt', () => {
    expect(appendHistory([], '  hello  ')).toEqual(['hello'])
  })

  test('ignores blank prompts', () => {
    expect(appendHistory(['hi'], '   ')).toEqual(['hi'])
  })

  test('skips consecutive duplicates', () => {
    expect(appendHistory(['hi'], 'hi')).toEqual(['hi'])
  })

  test('keeps the newest prompts when over the limit', () => {
    const history = Array.from({ length: 5 }, (_, i) => `p${i}`)
    expect(appendHistory(history, 'p5', 4)).toEqual(['p2', 'p3', 'p4', 'p5'])
  })
})

describe('moveHistory', () => {
  const history = ['first', 'second', 'third']

  test('returns null when there is no history', () => {
    expect(moveHistory([], null, -1, 'draft')).toBeNull()
  })

  test('ArrowUp from the draft recalls the newest prompt', () => {
    expect(moveHistory(history, null, -1, 'draft')).toEqual({ index: 2, text: 'third' })
  })

  test('ArrowUp walks back to the oldest and stops there', () => {
    expect(moveHistory(history, 2, -1, 'draft')).toEqual({ index: 1, text: 'second' })
    expect(moveHistory(history, 1, -1, 'draft')).toEqual({ index: 0, text: 'first' })
    expect(moveHistory(history, 0, -1, 'draft')).toEqual({ index: 0, text: 'first' })
  })

  test('ArrowDown is ignored while editing the draft', () => {
    expect(moveHistory(history, null, 1, 'draft')).toBeNull()
  })

  test('ArrowDown walks forward and restores the draft after the newest', () => {
    expect(moveHistory(history, 0, 1, 'draft')).toEqual({ index: 1, text: 'second' })
    expect(moveHistory(history, 2, 1, 'draft')).toEqual({ index: null, text: 'draft' })
  })
})
