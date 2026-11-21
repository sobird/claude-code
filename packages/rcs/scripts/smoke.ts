/**
 * In-process gateway smoke check.
 *
 * Boots the gateway on the in-memory repository bundle (no network, no Postgres)
 * and exercises the three paths that break first when auth or routing regresses:
 *
 * - `GET /health` returns 200
 * - `POST /v1/environments/bridge` accepts a real user API key and returns a
 *   verifiable environment token
 * - `GET /web/sessions` without credentials returns 401
 *
 * RCS_AUTH_SECRET and the bootstrap admin env are set here before any config or
 * token helper reads them, so `bun scripts/smoke.ts` works with no external env.
 * Secrets are never printed.
 */

process.env.RCS_AUTH_SECRET = 'rcs-smoke-secret'
process.env.ADMIN_USERNAME = 'smoke-admin'
process.env.ADMIN_PASSWORD = 'smoke-admin-password'
delete process.env.RCS_API_KEYS
delete process.env.RCS_BASE_URL

import { generateApiKey } from '@/auth/api-key'
import { verifyEnvironmentToken } from '@/auth/tokens'
import { loadConfig } from '@/config'
import { createMemoryRepositories } from '@/db/repositories'
import { createGateway } from '@/gateway'
import { ensureBootstrapAdmin } from '@/lib/bootstrap'

let failures = 0

function pass(message: string): void {
  console.log(`[ok] ${message}`)
}

function fail(message: string): void {
  failures += 1
  console.log(`[fail] ${message}`)
}

function check(condition: boolean, label: string, detail = ''): void {
  if (condition) pass(detail ? `${label}: ${detail}` : label)
  else fail(detail ? `${label}: ${detail}` : label)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const repos = createMemoryRepositories()

  await ensureBootstrapAdmin(repos)
  const admin = await repos.users.getByUsername('smoke-admin')
  if (!admin) {
    fail('bootstrap admin was not provisioned')
    return
  }

  // A real user API key goes through the same hashed lookup the routes use.
  const apiKey = generateApiKey()
  await repos.apiKeys.create({ userId: admin.id, name: 'smoke', prefix: apiKey.prefix, hash: apiKey.hash })

  const app = createGateway({ config, repos })

  // 1. Health probe.
  const health = await app.request('/health')
  const healthBody = await readJson(health)
  check(health.status === 200, 'GET /health', `status ${health.status}`)
  check(healthBody.status === 'ok', 'GET /health body', String(healthBody.status))

  // 2. Authenticated environment registration with a verifiable token.
  const bridge = await app.request('/v1/environments/bridge', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_name: 'smoke-host' }),
  })
  const bridgeBody = await readJson(bridge)
  check(bridge.status === 200, 'POST /v1/environments/bridge', `status ${bridge.status}`)

  const environmentId = typeof bridgeBody.environment_id === 'string' ? bridgeBody.environment_id : ''
  const environmentSecret = typeof bridgeBody.environment_secret === 'string' ? bridgeBody.environment_secret : ''
  const claims = environmentSecret ? await verifyEnvironmentToken(environmentSecret) : null
  check(environmentId.length > 0, 'environment id returned', environmentId || '(missing)')
  check(claims !== null, 'environment token verifies')
  check(
    claims !== null && claims.environmentId === environmentId && claims.userId === admin.id,
    'environment token is bound to the returned environment and user',
  )

  // 3. Unauthenticated web request is rejected.
  const unauthorized = await app.request('/web/sessions')
  check(unauthorized.status === 401, 'GET /web/sessions (unauthenticated)', `status ${unauthorized.status}`)
}

try {
  await main()
} catch (error) {
  fail(`unexpected error: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures > 0) {
  console.log(`[smoke] ${failures} check(s) failed`)
  process.exit(1)
}

console.log('[smoke] all checks passed')
