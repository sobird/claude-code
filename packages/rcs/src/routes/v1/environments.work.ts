/**
 * V1 work-dispatch routes.
 *
 * Polling, acknowledging, and stopping require the environment credential. Heartbeats
 * additionally accept the worker token carried in the work secret (`session_ingress_token`).
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '../../auth/context.js'
import type { WorkItemRecord } from '../../contracts.js'
import { updatePollTime } from '../../services/environment.js'
import { ackWork, heartbeatWork, pollWork, stopWork } from '../../services/work-dispatch.js'
import { legacyEnvironmentAuth, notFound, workerOrEnvironmentAuth } from '../common.js'

const app = new Hono<AppEnv>()

/**
 * The route's `:id` must own the work item. When the request authenticated with a worker
 * token, the token's session must also be the item's session.
 */
async function loadWorkForEnvironment(c: AppContext): Promise<WorkItemRecord | null> {
  const workId = c.req.param('workId')
  if (!workId) return null
  const item = await c.get('repos').workItems.getById(workId)
  if (!item || item.environmentId !== c.req.param('id')) return null
  const workerSessionId = c.get('workerSessionId') as string | undefined
  if (workerSessionId && item.sessionId !== workerSessionId) return null
  return item
}

/** GET /v1/environments/:id/work/poll — Long-poll for the next work item. */
app.get('/:id/work/poll', legacyEnvironmentAuth, async (c) => {
  const repos = c.get('repos')
  const environmentId = c.get('environment').id
  await updatePollTime(repos, environmentId)

  const timeoutParam = c.req.query('timeout')
  const timeout = timeoutParam === undefined ? undefined : Number.parseFloat(timeoutParam)
  const work = await pollWork(repos, environmentId, timeout)

  // 204 lets the client's HTTP layer parse the empty body as null.
  if (!work) return c.body(null, 204)
  return c.json(work, 200)
})

/** POST /v1/environments/:id/work/:workId/ack — Acknowledge dispatched work. */
app.post('/:id/work/:workId/ack', legacyEnvironmentAuth, async (c) => {
  const item = await loadWorkForEnvironment(c)
  if (!item) return notFound(c, 'Work item not found')
  await ackWork(c.get('repos'), item.id)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/environments/:id/work/:workId/stop — Stop dispatched work. */
app.post('/:id/work/:workId/stop', legacyEnvironmentAuth, async (c) => {
  const item = await loadWorkForEnvironment(c)
  if (!item) return notFound(c, 'Work item not found')
  await stopWork(c.get('repos'), item.id)
  return c.json({ status: 'ok' }, 200)
})

/** POST /v1/environments/:id/work/:workId/heartbeat — Extend the work lease. */
app.post('/:id/work/:workId/heartbeat', workerOrEnvironmentAuth, async (c) => {
  const item = await loadWorkForEnvironment(c)
  if (!item) return notFound(c, 'Work item not found')
  const result = await heartbeatWork(c.get('repos'), item.id)
  return c.json(result, 200)
})

export default app
