import { describe, expect, test } from 'bun:test'

import type { RawParsedOutput } from '../parser.js'
import { transformRawOutput } from '../parser.js'

function rawOutput(overrides: Partial<RawParsedOutput>): RawParsedOutput {
  return {
    valid: true,
    errors: [],
    statements: [],
    variables: [],
    hasStopParsing: false,
    originalCommand: 'Get-Process',
    ...overrides,
  }
}

describe('transformRawOutput background job flag', () => {
  test('propagates hasBackgroundJob from the parser output', () => {
    const parsed = transformRawOutput(rawOutput({ hasBackgroundJob: true }))

    expect(parsed.hasBackgroundJob).toBe(true)
  })

  test('leaves hasBackgroundJob unset when the parser reports no background job', () => {
    const parsed = transformRawOutput(rawOutput({ hasBackgroundJob: false }))

    expect(parsed.hasBackgroundJob).toBeUndefined()
  })
})
