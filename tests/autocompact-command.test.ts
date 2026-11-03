import { expect, test } from 'bun:test'

import { parseAutocompactArgs } from '../src/commands/autocompact/index'
import { parseAutocompactEnvWindow, showAutocompactWindow } from '../src/commands/autocompact/window'

test('parseAutocompactArgs: show / reset', () => {
  expect(parseAutocompactArgs('')).toEqual({ action: 'show' })
  expect(parseAutocompactArgs('  ')).toEqual({ action: 'show' })
  expect(parseAutocompactArgs('reset')).toEqual({ action: 'reset' })
  expect(parseAutocompactArgs('UNSET')).toEqual({ action: 'reset' })
  expect(parseAutocompactArgs('default')).toEqual({ action: 'reset' })
})

test('parseAutocompactArgs: valid set forms', () => {
  expect(parseAutocompactArgs('500k')).toEqual({ action: 'set', window: 500_000 })
  expect(parseAutocompactArgs('500000')).toEqual({ action: 'set', window: 500_000 })
  expect(parseAutocompactArgs('1m')).toEqual({ action: 'set', window: 1_000_000 })
  expect(parseAutocompactArgs('200')).toEqual({ action: 'set', window: 200_000 })
  expect(parseAutocompactArgs('100')).toEqual({ action: 'set', window: 100_000 })
  expect(parseAutocompactArgs('1000')).toEqual({ action: 'set', window: 1_000_000 })
})

test('parseAutocompactArgs: invalid forms', () => {
  expect(parseAutocompactArgs('50000')).toEqual({ action: 'invalid' })
  expect(parseAutocompactArgs('abc')).toEqual({ action: 'invalid' })
  expect(parseAutocompactArgs('2m')).toEqual({ action: 'invalid' })
  expect(parseAutocompactArgs('99999')).toEqual({ action: 'invalid' })
})

test('parseAutocompactEnvWindow: parse and clamp', () => {
  expect(parseAutocompactEnvWindow(undefined)).toBeUndefined()
  expect(parseAutocompactEnvWindow('150000')).toBe(150_000)
  // Below the minimum is raised to it; above the maximum is capped.
  expect(parseAutocompactEnvWindow('50000')).toBe(100_000)
  expect(parseAutocompactEnvWindow('2000000')).toBe(1_000_000)
  expect(parseAutocompactEnvWindow('abc')).toBeUndefined()
  expect(parseAutocompactEnvWindow('-1')).toBeUndefined()
})

// The settings-writing set/reset path touches disk via updateSettingsForSource,
// so it is exercised through the command rather than as a pure unit test.
test('showAutocompactWindow: settings source line', () => {
  const text = showAutocompactWindow('claude-sonnet-4-5', 150_000)
  expect(text.split('\n')[0]).toBe('Auto-compact window: 150k tokens (from settings)')
  expect(text).toContain('Auto-compact summarizes the conversation')
})
