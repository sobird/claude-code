/**
 * Web environment listing. Members see their own active environments plus the
 * legacy unowned ones (unclaimed environments are shared); admins see all.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import type { EnvironmentRecord } from '../../contracts.js'
import { listActiveEnvironments, toEnvironmentResponse } from '../../services/environment.js'
import { legacyUserAuth } from '../common.js'

const app = new Hono<AppEnv>()

/** GET /web/environments — Active environments visible to the caller. */
app.get('/environments', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  let environments: EnvironmentRecord[]
  if (user.role === 'admin') {
    environments = await listActiveEnvironments(repos, { isAdmin: true })
  } else {
    const byId = new Map<string, EnvironmentRecord>()
    for (const record of await listActiveEnvironments(repos, { ownerUserId: user.id })) byId.set(record.id, record)
    for (const record of await repos.environments.listActive()) {
      if (record.ownerUserId === null) byId.set(record.id, record)
    }
    environments = [...byId.values()]
  }
  return c.json(
    environments.map((record) => toEnvironmentResponse(record)),
    200,
  )
})

export default app
