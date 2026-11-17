import { afterEach, describe, expect, test } from 'bun:test'

import { getApiBaseUrl } from '../api-client'

const env = process.env as Record<string, string | undefined>
const globals = globalThis as unknown as { window?: unknown }
const originalApiUrl = env.NEXT_PUBLIC_RCS_API_URL
const originalNodeEnv = env.NODE_ENV
const originalWindow = globals.window

afterEach(() => {
  if (originalApiUrl === undefined) delete env.NEXT_PUBLIC_RCS_API_URL
  else env.NEXT_PUBLIC_RCS_API_URL = originalApiUrl
  if (originalNodeEnv === undefined) delete env.NODE_ENV
  else env.NODE_ENV = originalNodeEnv
  if (originalWindow === undefined) delete globals.window
  else globals.window = originalWindow
})

describe('getApiBaseUrl', () => {
  test('prefers the configured gateway origin', () => {
    env.NEXT_PUBLIC_RCS_API_URL = 'https://gateway.example.com/'
    expect(getApiBaseUrl()).toBe('https://gateway.example.com')
  })

  test('derives the gateway on the page host in development', () => {
    delete env.NEXT_PUBLIC_RCS_API_URL
    env.NODE_ENV = 'development'
    globals.window = { location: { protocol: 'http:', hostname: '192.168.50.100' } }
    expect(getApiBaseUrl()).toBe('http://192.168.50.100:4000')
  })

  test('stays same-origin outside development', () => {
    delete env.NEXT_PUBLIC_RCS_API_URL
    env.NODE_ENV = 'production'
    globals.window = { location: { protocol: 'http:', hostname: 'ui.example.com' } }
    expect(getApiBaseUrl()).toBe('')
  })
})
