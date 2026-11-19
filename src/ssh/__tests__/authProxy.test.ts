import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { createAuthProxy, resolveProxyAuthHeaders } from '../sshAuthProxy.js'

type Captured = {
  method: string
  path: string
  authorization: string | null
  apiKey: string | null
  beta: string | null
  contentType: string | null
  body: string
}

function startUpstream(): { server: ReturnType<typeof Bun.serve>; captured: Captured[] } {
  const captured: Captured[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      captured.push({
        method: req.method,
        path: `${url.pathname}${url.search}`,
        authorization: req.headers.get('authorization'),
        apiKey: req.headers.get('x-api-key'),
        beta: req.headers.get('anthropic-beta'),
        contentType: req.headers.get('content-type'),
        body: await req.text(),
      })
      return new Response('upstream-ok', { status: 200 })
    },
  })
  return { server, captured }
}

const upstream = startUpstream()
afterAll(() => upstream.server.stop(true))

describe('resolveProxyAuthHeaders', () => {
  const base = {
    authHeaders: () => ({ headers: { 'x-api-key': 'placeholder-key' } }),
    getApiKeyFromHelper: async () => null,
    env: () => ({}) as Record<string, string | undefined>,
  }

  test('prefers ANTHROPIC_AUTH_TOKEN as a Bearer token over the placeholder x-api-key', async () => {
    const result = await resolveProxyAuthHeaders({ ...base, env: () => ({ ANTHROPIC_AUTH_TOKEN: 'real-token' }) })
    expect(result.headers.Authorization).toBe('Bearer real-token')
    expect(result.headers['x-api-key']).toBeUndefined()
  })

  test('falls back to the apiKeyHelper token', async () => {
    const result = await resolveProxyAuthHeaders({ ...base, getApiKeyFromHelper: async () => 'helper-token' })
    expect(result.headers.Authorization).toBe('Bearer helper-token')
  })

  test('an explicit token wins even when getAuthHeaders would return OAuth (matches client)', async () => {
    const result = await resolveProxyAuthHeaders({
      ...base,
      authHeaders: () => ({ headers: { Authorization: 'Bearer oauth', 'anthropic-beta': 'oauth-beta' } }),
      env: () => ({ ANTHROPIC_AUTH_TOKEN: 'explicit-token' }),
    })
    expect(result.headers.Authorization).toBe('Bearer explicit-token')
  })

  test('falls back to getAuthHeaders when no bearer token is available', async () => {
    const result = await resolveProxyAuthHeaders(base)
    expect(result.headers['x-api-key']).toBe('placeholder-key')
  })
})

test('strips remote placeholder credentials and injects local auth', async () => {
  const proxy = createAuthProxy({
    upstreamBaseUrl: `http://127.0.0.1:${upstream.server.port}`,
    authHeaders: () => ({
      headers: { Authorization: 'Bearer real-token', 'anthropic-beta': 'local-beta' },
    }),
  })
  try {
    const response = await fetch('http://api.anthropic.com/v1/messages?beta=1', {
      method: 'POST',
      unix: proxy.socketPath,
      headers: {
        authorization: 'Bearer placeholder',
        'x-api-key': 'placeholder-key',
        'anthropic-beta': 'feature-a',
        'content-type': 'application/json',
      },
      body: '{"model":"x"}',
    })
    expect(await response.text()).toBe('upstream-ok')

    const seen = upstream.captured.at(-1)!
    expect(seen.method).toBe('POST')
    expect(seen.path).toBe('/v1/messages?beta=1')
    expect(seen.authorization).toBe('Bearer real-token')
    expect(seen.apiKey).toBeNull()
    expect(seen.beta).toContain('local-beta')
    expect(seen.beta).toContain('feature-a')
    expect(seen.contentType).toBe('application/json')
    expect(seen.body).toBe('{"model":"x"}')
  } finally {
    proxy.stop()
  }
})

test('surfaces a 401 when local auth is unavailable', async () => {
  const proxy = createAuthProxy({
    upstreamBaseUrl: `http://127.0.0.1:${upstream.server.port}`,
    authHeaders: () => ({ headers: {}, error: 'No API key available' }),
  })
  try {
    const response = await fetch('http://api.anthropic.com/v1/messages', {
      method: 'POST',
      unix: proxy.socketPath,
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('No API key available')
  } finally {
    proxy.stop()
  }
})

test('returns 502 when the upstream is unreachable', async () => {
  const proxy = createAuthProxy({
    upstreamBaseUrl: 'http://127.0.0.1:1',
    authHeaders: () => ({ headers: { Authorization: 'Bearer real' } }),
  })
  try {
    const response = await fetch('http://api.anthropic.com/v1/messages', {
      method: 'POST',
      unix: proxy.socketPath,
      body: '{}',
    })
    expect(response.status).toBe(502)
  } finally {
    proxy.stop()
  }
})

test('stop() removes the socket file', () => {
  const proxy = createAuthProxy({ upstreamBaseUrl: 'http://127.0.0.1:1' })
  const socketPath = proxy.socketPath
  expect(existsSync(socketPath)).toBe(true)
  proxy.stop()
  expect(existsSync(socketPath)).toBe(false)
})
