import { describe, expect, test } from 'bun:test'

import { PATH_EXTRACTORS } from '../pathValidation.js'

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
