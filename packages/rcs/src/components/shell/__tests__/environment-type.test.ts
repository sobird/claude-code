import { describe, expect, test } from 'bun:test'

import { environmentTypeLabel } from '../environment-type'

describe('environmentTypeLabel', () => {
  test('maps known worker types to their message keys', () => {
    expect(environmentTypeLabel('claude_code')).toBe('claudeCode')
    expect(environmentTypeLabel('acp')).toBe('acpAgent')
    expect(environmentTypeLabel('deepseek')).toBe('deepseek')
  })

  test('an unknown worker type has no label and is shown verbatim', () => {
    expect(environmentTypeLabel('future_agent')).toBeUndefined()
  })
})
