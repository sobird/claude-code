import { describe, expect, test } from 'bun:test'

import { resolveConfig } from '../src/config'

describe('resolveConfig', () => {
  test('falls back to defaults when only the API key is provided', () => {
    const config = resolveConfig({}, { RCS_API_KEY: 'env-key' })
    expect(config).toEqual({
      rcsBaseUrl: 'http://localhost:4000',
      apiKey: 'env-key',
      workdir: process.cwd(),
      sessionTitle: undefined,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId: undefined,
    })
  })

  test('config fields override the same environment variables', () => {
    const config = resolveConfig(
      {
        apiKey: 'config-key',
        rcsBaseUrl: 'https://rcs.example.com/',
        workdir: '/srv/work',
        sessionTitle: 'ops',
        provider: 'custom',
        model: 'custom-model',
        sessionId: 'cse_existing',
      },
      {
        RCS_API_KEY: 'env-key',
        RCS_BASE_URL: 'http://env',
        DSH_WORKDIR: '/env/work',
        DSH_PROVIDER: 'env-provider',
        DSH_MODEL: 'env-model',
        RCS_SESSION_ID: 'cse_env',
      },
    )
    expect(config).toEqual({
      rcsBaseUrl: 'https://rcs.example.com',
      apiKey: 'config-key',
      workdir: '/srv/work',
      sessionTitle: 'ops',
      provider: 'custom',
      model: 'custom-model',
      sessionId: 'cse_existing',
    })
  })

  test('environment fills fields the config leaves empty', () => {
    const config = resolveConfig(
      { apiKey: 'k', rcsBaseUrl: '' },
      { RCS_BASE_URL: 'http://env:4000', RCS_SESSION_TITLE: 'from-env', RCS_SESSION_ID: 'cse_env' },
    )
    expect(config.rcsBaseUrl).toBe('http://env:4000')
    expect(config.sessionTitle).toBe('from-env')
    expect(config.sessionId).toBe('cse_env')
  })

  test('rejects a missing API key', () => {
    expect(() => resolveConfig({}, {})).toThrow('RCS_API_KEY is required')
  })
})
