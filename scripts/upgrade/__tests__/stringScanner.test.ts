import { describe, expect, test } from 'bun:test'

import { extractStringLiterals } from '../stringScanner'

describe('extractStringLiterals', () => {
  test('handles quotes, escapes and templates', () => {
    const src = String.raw`a="x"; b='y'; c="q\"z"; d='a\\b'; e=` + '`' + 'plain' + '`' + '; f=`interp${x}`'
    expect(extractStringLiterals(src).toSorted()).toEqual(['a\\b', 'plain', 'q"z', 'x', 'y'].toSorted())
  })

  test('ignores comments and regex literals', () => {
    expect(extractStringLiterals('// "no"\n/* "no2" */ const r=/ab"/g; const s="yes"')).toEqual(['yes'])
  })
})
