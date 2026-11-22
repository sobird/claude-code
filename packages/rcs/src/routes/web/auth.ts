/**
 * Web session binding.
 *
 * Binds an existing session to the authenticated user. Legacy unowned sessions are
 * claimed atomically; sessions already owned by somebody else stay put.
 */

import { Hono } from 'hono'

import type { AppEnv } from '@/auth/context'
import { toWebSessionId } from '@/contracts'
import { legacyUserAuth, readJson, webForbidden, webNotFound } from '@/routes/common'
import { resolveAccessibleSession } from '@/services/session'

const app = new Hono<AppEnv>()

/** POST /web/bind — Bind (claim) a session for the caller. */
app.post('/bind', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const requested = typeof body.sessionId === 'string' ? body.sessionId : ''

  if (!requested) {
    return c.json({ error: 'sessionId is required', code: 'session_id_required' }, 400)
  }
  const access = await resolveAccessibleSession(repos, requested, c.get('user'))
  if (!access.ok) return access.reason === 'not_found' ? webNotFound(c) : webForbidden(c)

  return c.json({ ok: true, sessionId: toWebSessionId(access.sessionId) }, 200)
})

export default app
