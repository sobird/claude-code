/**
 * V1 environment routes: registration, deregistration, and reconnect.
 *
 * Registration binds the environment to the authenticated user; a client-supplied
 * `environment_id` is only reused when the service finds it active and owned by the same
 * user (a foreign/stale id transparently yields a fresh environment).
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { registerEnvironment } from '../../services/environment.js'
import { reconnectEnvironment, deregisterEnvironment } from '../../services/environment.js'
import { reconnectWorkForEnvironment } from '../../services/work-dispatch.js'
import { forbidden, legacyUserAuth, notFound, readJson } from '../common.js'

const app = new Hono<AppEnv>()

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalRecord(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** POST /v1/environments/bridge — Register (or re-register) an environment. */
app.post('/bridge', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  const body = await readJson(c)

  const metadata = optionalRecord(body.metadata)
  const metaWorkerType = metadata && typeof metadata.worker_type === 'string' ? metadata.worker_type : undefined
  const bodyWorkerType = typeof body.worker_type === 'string' ? body.worker_type : undefined
  const workerType = metaWorkerType || bodyWorkerType || undefined

  const maxSessions = typeof body.max_sessions === 'number' ? body.max_sessions : undefined

  const result = await registerEnvironment(repos, {
    environmentId: optionalString(body.environment_id) ?? null,
    ownerUserId: user.id,
    machineName: optionalString(body.machine_name),
    directory: optionalString(body.directory),
    branch: optionalString(body.branch),
    gitRepoUrl: optionalString(body.git_repo_url),
    maxSessions,
    workerType,
    bridgeId: optionalString(body.bridge_id),
    capabilities: optionalRecord(body.capabilities),
  })

  return c.json(result, 200)
})

/** DELETE /v1/environments/bridge/:id — Deregister an environment the caller owns. */
app.delete('/bridge/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  const environment = await repos.environments.getById(c.req.param('id'))
  if (!environment) return notFound(c, 'Environment not found')
  if (user.role !== 'admin' && environment.ownerUserId !== user.id) {
    return forbidden(c, 'Not your environment')
  }
  await deregisterEnvironment(repos, environment.id)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/environments/:id/bridge/reconnect — Reconnect an owned environment. */
app.post('/:id/bridge/reconnect', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  const environment = await repos.environments.getById(c.req.param('id'))
  if (!environment) return notFound(c, 'Environment not found')
  if (user.role !== 'admin' && environment.ownerUserId !== user.id) {
    return forbidden(c, 'Not your environment')
  }
  await reconnectEnvironment(repos, environment.id)
  await reconnectWorkForEnvironment(repos, environment.id)
  return c.json({ status: 'ok' }, 200)
})

export default app
