import { expect, test } from 'bun:test'

import { computeConsecutiveRapidRefills, isRapidRefillBreakerTripped } from '../src/services/compact/autoCompact.js'

test('counts rapid refills only when the last compact was within the window', () => {
  expect(computeConsecutiveRapidRefills(undefined)).toBe(0)
  expect(computeConsecutiveRapidRefills({ compacted: false, turnId: '', turnCounter: 0 })).toBe(0)
  expect(
    computeConsecutiveRapidRefills({ compacted: true, turnId: 't', turnCounter: 1, consecutiveRapidRefills: 1 }),
  ).toBe(2)
  expect(
    computeConsecutiveRapidRefills({ compacted: true, turnId: 't', turnCounter: 3, consecutiveRapidRefills: 2 }),
  ).toBe(0)
})

test('trips at three consecutive rapid refills', () => {
  expect(isRapidRefillBreakerTripped(2)).toBe(false)
  expect(isRapidRefillBreakerTripped(3)).toBe(true)
})
