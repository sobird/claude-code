import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput, OUTPUT_MAX_LINES, shouldCollapseOutput } from '../format'

describe('shouldCollapseOutput', () => {
  test('keeps output at the line limit expanded', () => {
    const text = Array.from({ length: OUTPUT_MAX_LINES }, (_, i) => `line ${i}`).join('\n')
    expect(shouldCollapseOutput(text)).toBe(false)
  })

  test('collapses one line past the limit', () => {
    const text = Array.from({ length: OUTPUT_MAX_LINES + 1 }, (_, i) => `line ${i}`).join('\n')
    expect(shouldCollapseOutput(text)).toBe(true)
  })
})

describe('formatOutput', () => {
  test('returns long output in full instead of truncating it', () => {
    const long = 'x'.repeat(5000)
    const tool: ToolCallData = { id: 't1', title: 'Bash', status: 'complete', rawOutput: { output: long } }
    expect(formatOutput(tool)).toBe(long)
  })
})
