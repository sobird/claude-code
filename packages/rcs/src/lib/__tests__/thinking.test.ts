import { describe, expect, test } from 'bun:test'

import {
  buildSetThinkingRequest,
  THINKING_ON_BUDGET,
  thinkingChoiceFromPayload,
  thinkingTokensFor,
} from '@/lib/thinking'

describe('thinkingTokensFor', () => {
  test('default sends null so the CLI keeps its own default', () => {
    expect(thinkingTokensFor('default')).toBeNull()
  })

  test('on sends the explicit budget', () => {
    expect(thinkingTokensFor('on')).toBe(THINKING_ON_BUDGET)
    expect(THINKING_ON_BUDGET).toBeGreaterThan(0)
  })

  test('off sends zero', () => {
    expect(thinkingTokensFor('off')).toBe(0)
  })
})

describe('thinkingChoiceFromPayload', () => {
  test('a positive number means on', () => {
    expect(thinkingChoiceFromPayload(16000)).toBe('on')
  })

  test('zero means off', () => {
    expect(thinkingChoiceFromPayload(0)).toBe('off')
  })

  test('null, negatives, and non-numbers are indeterminate', () => {
    expect(thinkingChoiceFromPayload(null)).toBeNull()
    expect(thinkingChoiceFromPayload(undefined)).toBeNull()
    expect(thinkingChoiceFromPayload(-1)).toBeNull()
    expect(thinkingChoiceFromPayload('16000')).toBeNull()
    expect(thinkingChoiceFromPayload({})).toBeNull()
  })
})

describe('buildSetThinkingRequest', () => {
  test('wraps the token value in the control envelope', () => {
    expect(buildSetThinkingRequest('req-1', 'on')).toEqual({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: THINKING_ON_BUDGET },
    })
  })

  test('carries off as zero', () => {
    expect(buildSetThinkingRequest('req-2', 'off')).toMatchObject({
      request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 },
    })
  })

  test('carries default as null', () => {
    expect(buildSetThinkingRequest('req-3', 'default')).toMatchObject({
      request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: null },
    })
  })
})
