import { afterEach, expect, test } from 'bun:test'

import { parseAutocompactArgs } from '../src/commands/autocompact/index'
import { parseAutocompactEnvWindow, showAutocompactWindow } from '../src/commands/autocompact/window'
import { resolveAutocompactWindow } from '../src/services/compact/autocompactWindow'

const ENV_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
const originalEnv = process.env[ENV_KEY]
const MODEL = 'claude-sonnet-4-5' // 200k model context window

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = originalEnv
  }
})

test('parseAutocompactArgs: show / reset', () => {
  expect(parseAutocompactArgs('')).toEqual({ action: 'show' })
  expect(parseAutocompactArgs('  ')).toEqual({ action: 'show' })
  expect(parseAutocompactArgs('reset')).toEqual({ action: 'reset' })
  expect(parseAutocompactArgs('RESET')).toEqual({ action: 'reset' })
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
  // Bare values outside the [100,1000] thousands-shorthand are taken literally.
  expect(parseAutocompactArgs('99')).toEqual({ action: 'invalid' })
  expect(parseAutocompactArgs('1001')).toEqual({ action: 'invalid' })
  // Fractional k values below the 100k floor.
  expect(parseAutocompactArgs('1.5k')).toEqual({ action: 'invalid' })
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

test('resolveAutocompactWindow: settings beats model default', () => {
  delete process.env[ENV_KEY]
  expect(resolveAutocompactWindow(MODEL, 150_000)).toEqual({
    window: 150_000,
    configured: 150_000,
    source: 'settings',
  })
})

test('resolveAutocompactWindow: env beats settings', () => {
  process.env[ENV_KEY] = '180000'
  expect(resolveAutocompactWindow(MODEL, 150_000)).toEqual({
    window: 180_000,
    configured: 180_000,
    source: 'env',
  })
})

test('resolveAutocompactWindow: values above the model are capped', () => {
  delete process.env[ENV_KEY]
  expect(resolveAutocompactWindow(MODEL, 500_000)).toEqual({
    window: 200_000,
    configured: 500_000,
    source: 'settings',
  })

  process.env[ENV_KEY] = '500000'
  expect(resolveAutocompactWindow(MODEL, 150_000)).toEqual({
    window: 200_000,
    configured: 500_000,
    source: 'env',
  })
})

test('resolveAutocompactWindow: env below the minimum is clamped to 100k', () => {
  process.env[ENV_KEY] = '50000'
  expect(resolveAutocompactWindow(MODEL, undefined)).toEqual({
    window: 100_000,
    configured: 100_000,
    source: 'env',
  })
})

test('showAutocompactWindow: settings source line', () => {
  delete process.env[ENV_KEY]
  const text = showAutocompactWindow(MODEL, 150_000)
  expect(text.split('\n')[0]).toBe('Auto-compact window: 150k tokens (from settings)')
  expect(text).toContain('Auto-compact summarizes the conversation')
})

test('showAutocompactWindow: model default line', () => {
  delete process.env[ENV_KEY]
  const text = showAutocompactWindow(MODEL, undefined)
  expect(text.split('\n')[0]).toBe('Auto-compact window: 200k tokens (model default)')
  expect(text).toContain('Auto-compact summarizes the conversation')
})
