import { describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { createPathChecker, PATH_EXTRACTORS } from '../pathValidation.js'

describe('PATH_EXTRACTORS — grep/rg pattern files', () => {
  test('grep -f captures the pattern file as a path', () => {
    const paths = PATH_EXTRACTORS.grep(['-f', '/etc/patterns', 'file.txt'])
    expect(paths).toContain('/etc/patterns')
    expect(paths).toContain('file.txt')
  })

  test('grep --file=... inline value is captured', () => {
    const paths = PATH_EXTRACTORS.grep(['--file=/etc/patterns', 'in.txt'])
    expect(paths).toContain('/etc/patterns')
  })

  test('grep -f with no positional path still yields the pattern file', () => {
    const paths = PATH_EXTRACTORS.grep(['-f', '/etc/patterns'])
    expect(paths).toEqual(['/etc/patterns'])
  })

  test('grep -e pattern is not treated as a path', () => {
    const paths = PATH_EXTRACTORS.grep(['-e', 'pat', 'file.txt'])
    expect(paths).not.toContain('pat')
    expect(paths).toContain('file.txt')
  })

  test('rg -f captures the pattern file as a path', () => {
    const paths = PATH_EXTRACTORS.rg(['-f', '/etc/patterns', '.'])
    expect(paths).toContain('/etc/patterns')
    expect(paths).toContain('.')
  })

  test('rg -f with no positional path still yields the pattern file (not the default)', () => {
    const paths = PATH_EXTRACTORS.rg(['-f', '/etc/patterns'])
    expect(paths).toEqual(['/etc/patterns'])
  })
})

describe('PATH_EXTRACTORS — flag values that are not paths', () => {
  test('cut -d / treats the delimiter as a value, not a path', () => {
    expect(PATH_EXTRACTORS.cut(['-d', '/', 'file.txt'])).toEqual(['file.txt'])
  })

  test('cut --delimiter=/ keeps the inline delimiter out of paths', () => {
    expect(PATH_EXTRACTORS.cut(['--delimiter=/', 'file.txt'])).toEqual(['file.txt'])
  })

  test('paste -d / treats the delimiter as a value, not a path', () => {
    expect(PATH_EXTRACTORS.paste(['-d', '/', 'a.txt', 'b.txt'])).toEqual(['a.txt', 'b.txt'])
  })

  test('column -s / treats the separator as a value, not a path', () => {
    expect(PATH_EXTRACTORS.column(['-s', '/', 'file.txt'])).toEqual(['file.txt'])
  })

  test('awk program is skipped; the input file is kept', () => {
    expect(PATH_EXTRACTORS.awk(['{print $1}', 'file.txt'])).toEqual(['file.txt'])
  })

  test('awk -f validates both the program file and the input file', () => {
    const paths = PATH_EXTRACTORS.awk(['-f', 'prog.awk', 'file.txt'])
    expect(paths).toContain('prog.awk')
    expect(paths).toContain('file.txt')
  })

  test('awk -F separator and -v assignment are values, not paths', () => {
    expect(PATH_EXTRACTORS.awk(['-F:', '-v', 'x=y', '{print $1}', 'file.txt'])).toEqual(['file.txt'])
  })
})

describe('createPathChecker — acceptEdits suggestion', () => {
  const suggestionsOf = (result: ReturnType<ReturnType<typeof createPathChecker>>) =>
    result.behavior === 'ask' ? (result.suggestions ?? []).map((s) => s.type) : []

  test('default mode suggests acceptEdits for a blocked write', () => {
    const result = createPathChecker('mkdir')(['/nonexistent-outside-dir-x'], '/tmp', getEmptyToolPermissionContext())
    expect(suggestionsOf(result)).toContain('setMode')
  })

  test('bypassPermissions mode does not suggest acceptEdits (no silent downgrade)', () => {
    const context = { ...getEmptyToolPermissionContext(), mode: 'bypassPermissions' as const }
    const result = createPathChecker('mkdir')(['/nonexistent-outside-dir-x'], '/tmp', context)
    expect(suggestionsOf(result)).not.toContain('setMode')
  })
})
