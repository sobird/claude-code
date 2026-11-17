import { describe, expect, test } from 'bun:test'

import { buildSetModelRequest, normalizeModel, normalizeModelOptions } from '../model-settings'

describe('normalizeModel', () => {
  test('trims and accepts non-empty strings', () => {
    expect(normalizeModel(' sonnet ')).toBe('sonnet')
    expect(normalizeModel('default')).toBe('default')
  })

  test('rejects blanks and non-strings', () => {
    expect(normalizeModel('')).toBeNull()
    expect(normalizeModel('   ')).toBeNull()
    expect(normalizeModel(undefined)).toBeNull()
    expect(normalizeModel(null)).toBeNull()
    expect(normalizeModel(1)).toBeNull()
    expect(normalizeModel({})).toBeNull()
  })
})

describe('normalizeModelOptions', () => {
  test('keeps value, displayName, and description', () => {
    expect(
      normalizeModelOptions([
        { value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', supportsEffort: true },
      ]),
    ).toEqual([{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced' }])
  })

  test('falls back to the value for a missing display name', () => {
    expect(normalizeModelOptions([{ value: 'opus' }])).toEqual([{ value: 'opus', displayName: 'opus' }])
  })

  test('skips bad entries, blanks, and duplicates', () => {
    expect(
      normalizeModelOptions([null, 'x', { value: '' }, { value: '  ' }, { value: 'sonnet' }, { value: ' sonnet ' }]),
    ).toEqual([{ value: 'sonnet', displayName: 'sonnet' }])
  })

  test('caps the list', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ value: `m${i}`, displayName: `M${i}` }))
    expect(normalizeModelOptions(many)).toHaveLength(40)
  })

  test('returns an empty list for non-arrays', () => {
    expect(normalizeModelOptions(undefined)).toEqual([])
    expect(normalizeModelOptions({ models: [] })).toEqual([])
  })
})

describe('buildSetModelRequest', () => {
  test('omits the model key when resetting to default', () => {
    expect(buildSetModelRequest('req-1', null)).toEqual({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'set_model' },
    })
  })

  test('carries the model through', () => {
    expect(buildSetModelRequest('req-2', 'sonnet')).toEqual({
      type: 'control_request',
      request_id: 'req-2',
      request: { subtype: 'set_model', model: 'sonnet' },
    })
  })
})
