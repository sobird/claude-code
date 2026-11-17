/**
 * Account routes: password change and personal API-key management.
 *
 * Password changes only re-hash and persist the new secret; token issuance remains the
 * responsibility of the Next auth layer. API-key responses never include the raw key
 * (except in the one-time creation response) or the stored hash.
 */

import { Hono } from 'hono'

import { generateApiKey } from '../../auth/api-key.js'
import type { AppEnv } from '../../auth/context.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import type { ApiKeyRecord } from '../../contracts.js'
import { legacyUserAuth, readJson } from '../common.js'

const app = new Hono<AppEnv>()

function toApiKeyView(record: ApiKeyRecord) {
  return {
    id: record.id,
    name: record.name,
    prefix: record.tokenPrefix,
    last_used_at: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    revoked_at: record.revokedAt ? record.revokedAt.toISOString() : null,
    created_at: record.createdAt.toISOString(),
  }
}

/** POST /web/account/password — Change the caller's password. */
app.post('/account/password', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  const user = await repos.users.getById(c.get('user').id)
  if (!user) return c.json({ error: 'user not found', code: 'user_not_found' }, 401)
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return c.json({ error: 'current password is incorrect', code: 'current_password_incorrect' }, 400)
  }
  if (!newPassword) return c.json({ error: 'newPassword is required', code: 'new_password_required' }, 400)

  await repos.users.setPasswordHash(user.id, await hashPassword(newPassword))
  return c.json({ status: 'ok' }, 200)
})

/** GET /web/api-keys — List the caller's keys (metadata only). */
app.get('/api-keys', legacyUserAuth, async (c) => {
  const keys = await c.get('repos').apiKeys.listByUser(c.get('user').id)
  return c.json(keys.map(toApiKeyView), 200)
})

/** POST /web/api-keys — Mint a key; the raw secret is returned exactly once. */
app.post('/api-keys', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const name = typeof body.name === 'string' && body.name ? body.name : 'API key'
  const generated = generateApiKey()
  const record = await repos.apiKeys.create({
    userId: c.get('user').id,
    name,
    prefix: generated.prefix,
    hash: generated.hash,
  })
  return c.json({ ...toApiKeyView(record), key: generated.raw }, 200)
})

/** DELETE /web/api-keys/:id — Revoke one of the caller's keys. */
app.delete('/api-keys/:id', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const id = c.req.param('id')
  const keys = await repos.apiKeys.listByUser(c.get('user').id)
  const key = keys.find((record) => record.id === id)
  if (!key) return c.json({ error: 'API key not found', code: 'api_key_not_found' }, 404)
  await repos.apiKeys.revoke(key.id, new Date())
  return c.json({ status: 'ok' }, 200)
})

export default app
