/**
 * Web environment listing. Members see their own live environments plus the legacy
 * unowned ones (unclaimed environments are shared); admins see all. "Live" covers
 * `active`/`disconnected`/`offline` so a reaped-but-alive worker keeps its row instead
 * of flickering out of the list until its next poll.
 */

import { Hono } from 'hono'

import type { AppEnv } from '@/auth/context'
import type { EnvironmentRecord } from '@/contracts'
import { legacyUserAuth } from '@/routes/common'
import { listVisibleEnvironments, toEnvironmentResponse } from '@/services/environment'

const app = new Hono<AppEnv>()

/** GET /web/environments — Live environments visible to the caller, with their status. */
app.get('/environments', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')
  let environments: EnvironmentRecord[]
  if (user.role === 'admin') {
    environments = await listVisibleEnvironments(repos, { isAdmin: true })
  } else {
    const byId = new Map<string, EnvironmentRecord>()
    for (const record of await listVisibleEnvironments(repos, { ownerUserId: user.id })) byId.set(record.id, record)
    for (const record of await repos.environments.listVisible()) {
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
