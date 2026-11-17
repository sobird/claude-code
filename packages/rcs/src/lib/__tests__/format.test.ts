import { describe, expect, test } from 'bun:test'

import { formatEpochSeconds, formatIsoDate } from '../format'

const epoch = Date.UTC(2024, 0, 2, 3, 4, 5) / 1000

describe('formatEpochSeconds', () => {
  test('formats with the requested locale and medium date + short time', () => {
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(epoch * 1000),
    )
    expect(formatEpochSeconds(epoch, 'en')).toBe(expected)
    expect(formatEpochSeconds(epoch, 'zh-CN')).not.toBe('')
  })

  test('renders an empty string for missing input', () => {
    expect(formatEpochSeconds(null, 'en')).toBe('')
    expect(formatEpochSeconds(undefined, 'en')).toBe('')
    expect(formatEpochSeconds(0, 'en')).toBe('')
  })
})

describe('formatIsoDate', () => {
  test('formats with the requested locale', () => {
    const expected = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date('2024-01-02T03:04:05Z'))
    expect(formatIsoDate('2024-01-02T03:04:05Z', 'zh-CN')).toBe(expected)
  })

  test('renders an empty string for missing or invalid input', () => {
    expect(formatIsoDate(null, 'en')).toBe('')
    expect(formatIsoDate('not-a-date', 'en')).toBe('')
  })
})
