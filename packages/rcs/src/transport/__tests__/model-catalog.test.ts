import { afterEach, describe, expect, test } from 'bun:test'

import { clearModelCatalog, getCachedModels, loadModelCatalog } from '@/transport/model-catalog'

const MODELS = [{ value: 'sonnet', displayName: 'Sonnet' }]

afterEach(() => clearModelCatalog('s1'))

describe('loadModelCatalog', () => {
  test('caches a successful load', async () => {
    let calls = 0
    const first = await loadModelCatalog('s1', async () => {
      calls++
      return MODELS
    })
    const second = await loadModelCatalog('s1', async () => {
      calls++
      return []
    })
    expect(first).toEqual(MODELS)
    expect(second).toEqual(MODELS)
    expect(calls).toBe(1)
    expect(getCachedModels('s1')).toEqual(MODELS)
  })

  test('dedupes concurrent loads', async () => {
    let calls = 0
    let release!: (models: typeof MODELS) => void
    const gate = new Promise<typeof MODELS>((resolve) => {
      release = resolve
    })
    const fetchModels = async () => {
      calls++
      return gate
    }
    const a = loadModelCatalog('s1', fetchModels)
    const b = loadModelCatalog('s1', fetchModels)
    release(MODELS)
    await expect(a).resolves.toEqual(MODELS)
    await expect(b).resolves.toEqual(MODELS)
    expect(calls).toBe(1)
  })

  test('does not cache a null result', async () => {
    await expect(loadModelCatalog('s1', async () => null)).resolves.toEqual([])
    expect(getCachedModels('s1')).toBeNull()
    await expect(loadModelCatalog('s1', async () => MODELS)).resolves.toEqual(MODELS)
    expect(getCachedModels('s1')).toEqual(MODELS)
  })

  test('refetches after a clear', async () => {
    await loadModelCatalog('s1', async () => MODELS)
    clearModelCatalog('s1')
    expect(getCachedModels('s1')).toBeNull()
    let calls = 0
    await loadModelCatalog('s1', async () => {
      calls++
      return [{ value: 'opus', displayName: 'Opus' }]
    })
    expect(calls).toBe(1)
    expect(getCachedModels('s1')).toEqual([{ value: 'opus', displayName: 'Opus' }])
  })
})
