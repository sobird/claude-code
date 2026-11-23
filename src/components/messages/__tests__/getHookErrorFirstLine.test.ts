import { describe, expect, test } from 'bun:test'

import { getHookErrorFirstLine } from '../AttachmentMessage.js'

describe('getHookErrorFirstLine', () => {
  test('prefers the first non-empty stderr line', () => {
    expect(getHookErrorFirstLine('\n  boom: permission denied\nat src/x.ts', '')).toBe('boom: permission denied')
  })

  test('falls back to stdout when stderr is blank', () => {
    expect(getHookErrorFirstLine('   ', 'line one\nline two')).toBe('line one')
  })

  test('strips the Expected schema hint', () => {
    const stderr = 'actual error\n\nExpected schema:\n{"continue":"boolean"}'
    expect(getHookErrorFirstLine(stderr, '')).toBe('actual error')
  })

  test('caps very long lines', () => {
    const long = 'x'.repeat(500)
    const out = getHookErrorFirstLine(long, '')
    expect(out.length).toBe(201)
    expect(out.endsWith('…')).toBe(true)
  })

  test('returns empty string when both are blank', () => {
    expect(getHookErrorFirstLine('', '   ')).toBe('')
  })
})
