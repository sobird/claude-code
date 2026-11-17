import { describe, expect, it } from 'bun:test'

import { SUGGESTION_LIMIT, toSuggestionPaths } from '../fileSuggestions.js'

describe('toSuggestionPaths', () => {
  it('keeps the display order', () => {
    const items = [{ displayText: 'src/b.ts' }, { displayText: 'src/a.ts' }]
    expect(toSuggestionPaths(items)).toEqual(['src/b.ts', 'src/a.ts'])
  })

  it('drops empty and duplicate entries', () => {
    const items = [{ displayText: '' }, { displayText: '  ' }, { displayText: 'a.ts' }, { displayText: 'a.ts' }]
    expect(toSuggestionPaths(items)).toEqual(['a.ts'])
  })

  it('caps the list at the limit', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ displayText: `f${i}.ts` }))
    expect(toSuggestionPaths(items)).toHaveLength(SUGGESTION_LIMIT)
    expect(toSuggestionPaths(items, 2)).toEqual(['f0.ts', 'f1.ts'])
  })

  it('returns an empty list for no suggestions', () => {
    expect(toSuggestionPaths([])).toEqual([])
  })
})
