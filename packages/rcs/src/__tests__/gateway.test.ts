/**
 * Gateway app factory tests.
 *
 * The gateway owns the mount table that mirrors the old server. These tests exercise it
 * through Hono's `app.request` (no Bun server) with in-memory repositories, so they never
 * touch Postgres or the network.
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { loadConfig } from '@/config'
import { createTestRepositories } from '@/db/testing'
import { createGateway } from '@/gateway'

async function makeGateway() {
  // Next's global types make `NODE_ENV` required on `ProcessEnv`; the same cast is used in
  // contracts.test.ts.
  const config = loadConfig({ RCS_AUTH_SECRET: 'test-secret' } as unknown as NodeJS.ProcessEnv)
  const repos = await createTestRepositories()
  return { config, repos, app: createGateway({ config, repos }) }
}

describe('createGateway', () => {
  beforeEach(() => {
    delete process.env.RCS_API_KEYS
  })

  test('health returns version and unauthenticated web routes 401', async () => {
    const { config, app } = await makeGateway()

    const health = await app.request('/health')
    expect(health.status).toBe(200)
    const body = (await health.json()) as { status: string; version: string }
    expect(body.status).toBe('ok')
    expect(body.version).toBe(config.version)

    expect((await app.request('/web/sessions')).status).toBe(401)
  })

  test('v1/v2/apc routes are mounted behind auth', async () => {
    const { app, repos } = await makeGateway()
    await repos.sessions.create({ id: 'cse_mount', title: 'mount test' })

    // 401 (not 404) proves each module is mounted at the old path.
    expect((await app.request('/v1/sessions', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/v1/environments/bridge', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/v1/code/sessions', { method: 'POST' })).status).toBe(401)
    // Ingress is mounted twice for buildSdkUrl with/without an Envoy /v1→/v2 rewrite.
    expect((await app.request('/v1/session_ingress/session/cse_mount/events', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/v2/session_ingress/session/cse_mount/events', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/acp/agents')).status).toBe(401)
  })

  test('webUrl defaults to baseUrl and honors RCS_WEB_URL', () => {
    const defaults = loadConfig({
      RCS_AUTH_SECRET: 'test-secret',
      RCS_BASE_URL: 'https://rcs.example.com/',
    } as unknown as NodeJS.ProcessEnv)
    expect(defaults.baseUrl).toBe('https://rcs.example.com')
    expect(defaults.webUrl).toBe('https://rcs.example.com')

    const split = loadConfig({
      RCS_AUTH_SECRET: 'test-secret',
      RCS_BASE_URL: 'https://rcs.example.com',
      RCS_WEB_URL: 'https://ui.example.com/',
    } as unknown as NodeJS.ProcessEnv)
    expect(split.webUrl).toBe('https://ui.example.com')
  })

  test('normalizes double-slash paths before routing', async () => {
    const { app } = await makeGateway()

    const response = await app.request('//health')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { status: string }).status).toBe('ok')
  })

  test('injects repositories into the context for every request', async () => {
    const { app } = await makeGateway()

    // The health handler does not read repos, so assert through an authenticated route:
    // a 401 proves middleware ran, while a missing `repos` would surface as a 500.
    const response = await app.request('/web/sessions', { headers: { Authorization: 'Bearer nope' } })
    expect(response.status).toBe(401)
  })
})
