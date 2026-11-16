/**
 * Web environment listing. Members see their own active environments; admins see all.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { listActiveEnvironments, toEnvironmentResponse } from '../../services/environment.js'
import { legacyUserAuth } from '../common.js'

const app = new Hono<AppEnv>()

/** GET /web/environments — Active environments visible to the caller. */
app.get('/environments', legacyUserAuth, async (c) => {
  const user = c.get('user')
  const environments = await listActiveEnvironments(c.get('repos'), {
    ownerUserId: user.id,
    isAdmin: user.role === 'admin',
  })
  return c.json(
    environments.map((record) => toEnvironmentResponse(record)),
    200,
  )
})

export default app
