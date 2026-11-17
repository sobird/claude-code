/**
 * Web session binding.
 *
 * Binds an existing session to the authenticated user. Legacy unowned sessions are
 * claimed atomically; sessions already owned by somebody else stay put.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { toWebSessionId } from '../../contracts.js'
import { getSession, resolveOwnedWebSessionId } from '../../services/session.js'
import { legacyUserAuth, readJson, webForbidden, webNotFound } from '../common.js'

const app = new Hono<AppEnv>()

/** POST /web/bind — Bind (claim) a session for the caller. */
app.post('/bind', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const requested = typeof body.sessionId === 'string' ? body.sessionId : ''

  if (!requested) {
    return c.json({ error: 'sessionId is required', code: 'session_id_required' }, 400)
  }
  if (!(await getSession(repos, requested))) return webNotFound(c)

  const owned = await resolveOwnedWebSessionId(repos, requested, c.get('user'))
  if (!owned) return webForbidden(c)

  return c.json({ ok: true, sessionId: toWebSessionId(owned) }, 200)
})

export default app
