import { describe, expect, test } from 'bun:test'

import { formatTokenCount, promptTokens, usageFromPayload } from '../token-usage'

describe('usageFromPayload', () => {
  test('reads usage nested in the assistant message', () => {
    expect(
      usageFromPayload({
        message: {
          usage: {
            input_tokens: 168,
            output_tokens: 42,
            cache_read_input_tokens: 82304,
            cache_creation_input_tokens: 100,
          },
        },
      }),
    ).toEqual({ input: 168, cached: 82404, output: 42 })
  })

  test('falls back to a top-level usage object', () => {
    expect(usageFromPayload({ usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({
      input: 10,
      cached: 0,
      output: 5,
    })
  })

  test('returns null without a usage object', () => {
    expect(usageFromPayload({ content: 'hi' })).toBeNull()
    expect(usageFromPayload(null)).toBeNull()
    expect(usageFromPayload('nope')).toBeNull()
  })

  test('ignores non-numeric fields', () => {
    expect(usageFromPayload({ usage: { input_tokens: '12', output_tokens: Number.NaN } })).toBeNull()
  })
})

describe('promptTokens', () => {
  test('counts cached tokens as part of the prompt', () => {
    expect(promptTokens({ input: 168, cached: 82404, output: 42 })).toBe(82572)
  })
})

describe('formatTokenCount', () => {
  test('keeps small counts as-is', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('abbreviates thousands and millions with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(82304)).toBe('82.3k')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(2_500_000)).toBe('2.5M')
  })
})
