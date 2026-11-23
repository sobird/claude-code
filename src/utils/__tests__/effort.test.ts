import { describe, expect, test } from 'bun:test'

import { modelSupportsMaxEffort } from '../effort.js'

describe('modelSupportsMaxEffort', () => {
  test('allows max on recent models', () => {
    expect(modelSupportsMaxEffort('claude-opus-4-6')).toBe(true)
    expect(modelSupportsMaxEffort('claude-sonnet-4-6')).toBe(true)
  })

  test('allows max on unknown / future model ids', () => {
    expect(modelSupportsMaxEffort('claude-fable-9')).toBe(true)
    expect(modelSupportsMaxEffort('my-custom-model')).toBe(true)
  })

  test('rejects legacy models on the denylist', () => {
    expect(modelSupportsMaxEffort('claude-opus-4-5')).toBe(false)
    expect(modelSupportsMaxEffort('claude-sonnet-4-5')).toBe(false)
    expect(modelSupportsMaxEffort('claude-3-5-sonnet')).toBe(false)
  })

  test('normalizes dated and versioned ids before matching', () => {
    expect(modelSupportsMaxEffort('claude-opus-4-5-20250101')).toBe(false)
    expect(modelSupportsMaxEffort('us.anthropic.claude-opus-4-5-v1:0')).toBe(false)
  })

  test('rejects haiku models', () => {
    expect(modelSupportsMaxEffort('claude-haiku-4-5')).toBe(false)
  })
})
