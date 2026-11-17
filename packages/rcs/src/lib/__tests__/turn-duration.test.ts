import { describe, expect, test } from 'bun:test'

import { formatTurnSeconds } from '../turn-duration'

describe('formatTurnSeconds', () => {
  test('keeps one decimal below ten seconds', () => {
    expect(formatTurnSeconds(1_200)).toBe('1.2')
    expect(formatTurnSeconds(9_940)).toBe('9.9')
  })

  test('rounds to whole seconds from ten upward', () => {
    expect(formatTurnSeconds(10_000)).toBe('10')
    expect(formatTurnSeconds(12_345)).toBe('12')
    expect(formatTurnSeconds(125_400)).toBe('125')
  })

  test('treats missing and negative durations as zero', () => {
    expect(formatTurnSeconds(0)).toBe('0.0')
    expect(formatTurnSeconds(-500)).toBe('0.0')
  })
})
