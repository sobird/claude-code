import { describe, expect, test } from 'bun:test'

import { diffLines, toolEditPreview } from '../text-diff'

describe('diffLines', () => {
  test('an unchanged text is all context', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
    ])
  })

  test('pure insertion marks only the new lines', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'context', text: 'c' },
    ])
  })

  test('pure deletion marks only the removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'context', text: 'c' },
    ])
  })

  test('a changed line is a removal followed by an addition', () => {
    expect(diffLines('a\nold\nc', 'a\nnew\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'old' },
      { type: 'add', text: 'new' },
      { type: 'context', text: 'c' },
    ])
  })

  test('a new file previews as added lines', () => {
    expect(diffLines('', 'one\ntwo')).toEqual([
      { type: 'add', text: 'one' },
      { type: 'add', text: 'two' },
    ])
  })

  test('oversized input degrades to remove-all plus add-all', () => {
    const before = Array.from({ length: 600 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 600 }, (_, i) => `new ${i}`).join('\n')
    const lines = diffLines(before, after, 600)
    expect(lines.slice(0, 3)).toEqual([
      { type: 'remove', text: 'old 0' },
      { type: 'remove', text: 'old 1' },
      { type: 'remove', text: 'old 2' },
    ])
    expect(lines.at(-1)).toEqual({ type: 'add', text: 'new 599' })
  })

  test('output is truncated to maxLines', () => {
    const before = 'a\nb\nc'
    const after = 'a\nB\nC'
    expect(diffLines(before, after, 2)).toHaveLength(2)
  })
})

describe('toolEditPreview', () => {
  test('Edit yields one old/new pair', () => {
    expect(toolEditPreview({ file_path: '/a.ts', old_string: 'x', new_string: 'y' })).toEqual([
      { before: 'x', after: 'y' },
    ])
  })

  test('MultiEdit yields one pair per edit', () => {
    expect(
      toolEditPreview({
        file_path: '/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual([
      { before: 'a', after: 'b' },
      { before: 'c', after: 'd' },
    ])
  })

  test('Write yields a whole-file addition', () => {
    expect(toolEditPreview({ file_path: '/a.ts', content: 'hello' })).toEqual([
      { before: '', after: 'hello', isNewFile: true },
    ])
  })

  test('other tools return null', () => {
    expect(toolEditPreview({ command: 'ls' })).toBeNull()
    expect(toolEditPreview({})).toBeNull()
  })

  test('malformed edit fields are ignored', () => {
    expect(toolEditPreview({ edits: [{ old_string: 'a' }] })).toBeNull()
  })
})
