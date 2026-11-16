/**
 * V2 code-session routes used by the CLI bridge.
 *
 * Creation returns the canonical `cse_…` session wrapped as `{ session }`. The bridge
 * handshake bumps the worker epoch and mints a worker token bound to the session.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { signWorkerToken } from '../../auth/tokens.js'
import { loadConfig } from '../../config.js'
import { createCodeSession, getSession, incrementEpoch, resolveOwnedWebSessionId } from '../../services/session.js'
import { forbidden, legacyUserAuth, notFound, readJson } from '../common.js'

const app = new Hono<AppEnv>()

/** POST /v1/code/sessions — Create a code session. */
app.post('/', legacyUserAuth, async (c) => {
  const body = await readJson(c)
  const session = await createCodeSession(c.get('repos'), {
    ownerUserId: c.get('user').id,
    environmentId: typeof body.environment_id === 'string' ? body.environment_id : null,
    title: typeof body.title === 'string' ? body.title : null,
    source: typeof body.source === 'string' ? body.source : 'remote-control',
    permissionMode: typeof body.permission_mode === 'string' ? body.permission_mode : null,
  })
  return c.json({ session }, 200)
})

/** POST /v1/code/sessions/:id/bridge — Return base URL, epoch, and worker JWT. */
app.post('/:id/bridge', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const requested = c.req.param('id')
  if (!(await getSession(repos, requested))) return notFound(c)
  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return forbidden(c)

  const config = loadConfig()
  const workerEpoch = await incrementEpoch(repos, owned)
  const workerJwt = await signWorkerToken(owned, config.jwtExpiresIn)

  return c.json(
    {
      api_base_url: config.baseUrl,
      worker_epoch: workerEpoch,
      worker_jwt: workerJwt,
      expires_in: config.jwtExpiresIn,
    },
    200,
  )
})

export default app
