import { describe, expect, test } from 'bun:test'

import { matchWildcardPattern } from '../shellRuleMatching.js'

describe('matchWildcardPattern — whitespace normalization', () => {
  test('default keeps literal whitespace (extra spaces do not match)', () => {
    expect(matchWildcardPattern('git commit *', 'git  commit -m x')).toBe(false)
  })

  test('normalize matches extra spaces', () => {
    expect(matchWildcardPattern('git commit *', 'git  commit -m x', false, true)).toBe(true)
  })

  test('normalize matches tabs', () => {
    expect(matchWildcardPattern('git commit *', 'git\tcommit\t-m x', false, true)).toBe(true)
  })

  test('normalize still matches the plain form', () => {
    expect(matchWildcardPattern('git commit *', 'git commit -m x', false, true)).toBe(true)
  })

  test('normalize does not over-match a different command', () => {
    expect(matchWildcardPattern('git commit *', 'git push origin', false, true)).toBe(false)
  })
})
