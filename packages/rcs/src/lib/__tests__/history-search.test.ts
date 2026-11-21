import { describe, expect, test } from 'bun:test'

import { searchHistory } from '@/lib/history-search'

const history = ['Fix the login bug', 'Add dark mode', 'fix the build', 'Write docs']

describe('searchHistory', () => {
  test('matches case-insensitively as a substring', () => {
    expect(searchHistory(history, 'FIX')).toEqual([
      { index: 2, text: 'fix the build' },
      { index: 0, text: 'Fix the login bug' },
    ])
  })

  test('returns newer entries first', () => {
    expect(searchHistory(history, 'the').map((match) => match.index)).toEqual([2, 0])
  })

  test('returns the newest entries for an empty or blank query', () => {
    expect(searchHistory(history, '').map((match) => match.index)).toEqual([3, 2, 1, 0])
    expect(searchHistory(history, '   ')).toHaveLength(4)
  })

  test('returns nothing when no entry matches', () => {
    expect(searchHistory(history, 'zzz')).toEqual([])
  })

  test('respects the limit', () => {
    expect(searchHistory(history, '', 2).map((match) => match.index)).toEqual([3, 2])
    expect(searchHistory(history, 'e', 1)).toEqual([{ index: 3, text: 'Write docs' }])
  })

  test('trims the query before matching', () => {
    expect(searchHistory(history, '  dark  ')).toEqual([{ index: 1, text: 'Add dark mode' }])
  })
})
