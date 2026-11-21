import { describe, expect, it } from 'bun:test'

import { applyFileSuggestion, fileQuery } from '@/lib/file-completion'

describe('fileQuery', () => {
  it('finds an @ token at the end of the text', () => {
    expect(fileQuery('hello @sr')).toEqual({ start: 6, end: 9, query: 'sr' })
  })

  it('only looks at the text before the caret', () => {
    expect(fileQuery('hello @src/x.ts', 8)).toEqual({ start: 6, end: 8, query: 's' })
  })

  it('returns an empty query for a bare @', () => {
    expect(fileQuery('@')).toEqual({ start: 0, end: 1, query: '' })
    expect(fileQuery('copy @')).toEqual({ start: 5, end: 6, query: '' })
  })

  it('ignores @ that does not start a word', () => {
    expect(fileQuery('mail a@b')).toBeNull()
    expect(fileQuery('hi /compact')).toBeNull()
    expect(fileQuery('plain text')).toBeNull()
  })

  it('ignores tokens that contain whitespace', () => {
    expect(fileQuery('look at @a b')).toBeNull()
    expect(fileQuery('@a\nb')).toBeNull()
  })

  it('supports quoted paths', () => {
    expect(fileQuery('@"my dir/fi')).toEqual({ start: 0, end: 11, query: 'my dir/fi' })
    expect(fileQuery('see @"a  b/c', 12)).toEqual({ start: 4, end: 12, query: 'a  b/c' })
  })

  it('ignores a closed quoted token', () => {
    expect(fileQuery('@"src/a.ts"')).toBeNull()
  })

  it('clamps the caret into the text', () => {
    expect(fileQuery('@src', 99)).toEqual({ start: 0, end: 4, query: 'src' })
    expect(fileQuery('@src', -1)).toBeNull()
  })
})

describe('applyFileSuggestion', () => {
  it('replaces the token and leaves a trailing space', () => {
    const text = 'look at @sr please'
    const token = fileQuery(text, 11)
    expect(token).not.toBeNull()
    expect(applyFileSuggestion(text, token!, 'src/a.ts')).toEqual({
      text: 'look at @src/a.ts  please',
      caret: 18,
    })
  })

  it('quotes paths with spaces', () => {
    const result = applyFileSuggestion('@my', { start: 0, end: 3, query: 'my' }, 'my dir/a.ts')
    expect(result.text).toBe('@"my dir/a.ts" ')
    expect(result.caret).toBe('@"my dir/a.ts" '.length)
  })

  it('completes a bare @ to the chosen path', () => {
    expect(applyFileSuggestion('@', { start: 0, end: 1, query: '' }, 'README.md').text).toBe('@README.md ')
  })
})
