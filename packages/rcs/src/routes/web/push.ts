/**
 * Web Push subscription routes.
 *
 * The browser fetches the VAPID public key from `/push/config` (disabled until the notifier
 * initializes), then registers and unregisters its PushSubscription. Subscriptions are
 * owner-scoped: `deleteByEndpoint` only removes the caller's own row.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { getPushPublicConfig } from '../../services/push-notifier.js'
import { legacyUserAuth, readJson } from '../common.js'

const app = new Hono<AppEnv>()

/** GET /web/push/config — VAPID public key and whether push is enabled. */
app.get('/push/config', legacyUserAuth, (c) => c.json(getPushPublicConfig(), 200))

/** POST /web/push/subscriptions — Store (or move) the caller's push subscription. */
app.post('/push/subscriptions', legacyUserAuth, async (c) => {
  const body = await readJson(c)
  const keys =
    body.keys && typeof body.keys === 'object' && !Array.isArray(body.keys)
      ? (body.keys as Record<string, unknown>)
      : {}
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : ''
  const auth = typeof keys.auth === 'string' ? keys.auth : ''

  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: 'invalid subscription', code: 'invalid_subscription' }, 400)
  }

  await c.get('repos').pushSubscriptions.upsertForUser(c.get('user').id, {
    endpoint,
    p256dh,
    auth,
    userAgent: c.req.header('user-agent') ?? null,
  })
  return c.body(null, 204)
})

/** DELETE /web/push/subscriptions?endpoint=… — Remove the caller's subscription. */
app.delete('/push/subscriptions', legacyUserAuth, async (c) => {
  const endpoint = c.req.query('endpoint')
  if (!endpoint) {
    return c.json({ error: 'endpoint is required', code: 'endpoint_required' }, 400)
  }
  await c.get('repos').pushSubscriptions.deleteByEndpoint(c.get('user').id, endpoint)
  return c.body(null, 204)
})

export default app
