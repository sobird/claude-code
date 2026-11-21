import { describe, expect, test } from 'bun:test'

import { advanceReveal } from '@/lib/smooth-text'

describe('advanceReveal', () => {
  test('advances toward the target without overshooting', () => {
    const next = advanceReveal(0, 10, 16)

    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(10)
  })

  test('snaps to the target when it shrinks below the current position', () => {
    expect(advanceReveal(50, 10, 16)).toBe(10)
  })

  test('does not move for non-positive elapsed time', () => {
    expect(advanceReveal(5, 100, 0)).toBe(5)
    expect(advanceReveal(5, 100, -30)).toBe(5)
  })

  test('clamps a long frame so a resumed tab catches up gradually', () => {
    const resumed = advanceReveal(0, 1000, 5000)

    expect(resumed).toBeGreaterThan(advanceReveal(0, 1000, 16))
    expect(resumed).toBeLessThan(1000)
  })
})
