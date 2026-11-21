import { describe, expect, test } from 'bun:test'

import { formatEpochSeconds, formatIsoDate } from '@/lib/format'

describe('formatEpochSeconds', () => {
  test('renders an empty string for missing input', () => {
    expect(formatEpochSeconds(null, 'en')).toBe('')
    expect(formatEpochSeconds(undefined, 'en')).toBe('')
    expect(formatEpochSeconds(0, 'en')).toBe('')
  })
})

describe('formatIsoDate', () => {
  test('renders an empty string for missing or invalid input', () => {
    expect(formatIsoDate(null, 'en')).toBe('')
    expect(formatIsoDate('not-a-date', 'en')).toBe('')
  })
})
