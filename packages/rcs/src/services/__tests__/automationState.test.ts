import { describe, expect, test } from 'bun:test'

import {
  automationStatesEqual,
  getAutomationStateEventPayload,
  getAutomationStateSnapshot,
  type AutomationStateResponse,
} from '@/services/automationState'

const DISABLED = { enabled: false, phase: null, next_tick_at: null, sleep_until: null }

describe('normalizeAutomationState', () => {
  test('returns undefined when metadata has no automation_state key', () => {
    expect(getAutomationStateSnapshot({})).toBeUndefined()
    expect(getAutomationStateSnapshot({ other: true })).toBeUndefined()
    expect(getAutomationStateSnapshot(null)).toBeUndefined()
    expect(getAutomationStateSnapshot(undefined)).toBeUndefined()
  })

  test('returns disabled state for missing or non-object input', () => {
    expect(getAutomationStateSnapshot({ automation_state: null })).toEqual(DISABLED)
    for (const val of ['string', 123, true, []]) {
      expect(getAutomationStateSnapshot({ automation_state: val })).toEqual(DISABLED)
    }
    expect(getAutomationStateSnapshot({ automation_state: { enabled: 'yes' } })).toEqual(DISABLED)
  })

  test('fully normalizes a complete valid state', () => {
    const result = getAutomationStateSnapshot({
      automation_state: { enabled: true, phase: 'sleeping', next_tick_at: 100, sleep_until: 200 },
    })
    expect(result).toEqual({ enabled: true, phase: 'sleeping', next_tick_at: 100, sleep_until: 200 })
  })

  test('nulls invalid phases and non-numeric timestamps', () => {
    const result = getAutomationStateSnapshot({
      automation_state: { enabled: true, phase: 'running', next_tick_at: 'soon', sleep_until: false },
    })
    expect(result).toEqual({ enabled: true, phase: null, next_tick_at: null, sleep_until: null })
  })
})

describe('getAutomationStateEventPayload', () => {
  test('defaults to disabled when automation_state is absent', () => {
    expect(getAutomationStateEventPayload({})).toEqual(DISABLED)
    expect(getAutomationStateEventPayload(null)).toEqual(DISABLED)
  })

  test('returns the normalized state when present', () => {
    const result = getAutomationStateEventPayload({
      automation_state: { enabled: true, phase: 'standby', next_tick_at: 50, sleep_until: 60 },
    })
    expect(result).toEqual({ enabled: true, phase: 'standby', next_tick_at: 50, sleep_until: 60 })
  })
})

describe('automationStatesEqual', () => {
  const base: AutomationStateResponse = {
    enabled: true,
    phase: 'standby',
    next_tick_at: 100,
    sleep_until: 200,
  }

  test('returns true for identical states', () => {
    expect(automationStatesEqual(base, { ...base })).toBe(true)
    expect(automationStatesEqual(DISABLED, { ...DISABLED })).toBe(true)
  })

  test('returns false when any field differs', () => {
    expect(automationStatesEqual(base, { ...base, enabled: false })).toBe(false)
    expect(automationStatesEqual(base, { ...base, phase: null })).toBe(false)
    expect(automationStatesEqual(base, { ...base, next_tick_at: null })).toBe(false)
    expect(automationStatesEqual(base, { ...base, sleep_until: null })).toBe(false)
  })
})
