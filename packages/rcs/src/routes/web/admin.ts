/**
 * Admin user management.
 *
 * Password hashes are never serialized. The last enabled admin cannot be demoted or
 * disabled (409), so the instance always retains an administrator.
 */

import { Hono } from 'hono'

import type { AppEnv } from '../../auth/context.js'
import { requireAdmin } from '../../auth/middleware.js'
import { hashPassword } from '../../auth/password.js'
import type { Role, UserRecord } from '../../contracts.js'
import type { UserPatch } from '../../db/repositories/types.js'
import { legacyUserAuth, readJson } from '../common.js'

const app = new Hono<AppEnv>()

app.use('/admin/*', legacyUserAuth, requireAdmin)

function toUserView(record: UserRecord) {
  return {
    id: record.id,
    username: record.username,
    display_name: record.displayName,
    role: record.role,
    disabled_at: record.disabledAt ? record.disabledAt.toISOString() : null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  }
}

function parseRole(value: unknown): Role | undefined {
  return value === 'admin' || value === 'member' ? value : undefined
}

/** Count enabled admins other than `excludeId`. */
async function otherEnabledAdmins(repos: AppEnv['Variables']['repos'], excludeId: string): Promise<number> {
  const users = await repos.users.list()
  return users.filter((user) => user.role === 'admin' && user.disabledAt === null && user.id !== excludeId).length
}

/** GET /web/admin/users — List users without password hashes. */
app.get('/admin/users', async (c) => {
  const users = await c.get('repos').users.list()
  return c.json(users.map(toUserView), 200)
})

/** POST /web/admin/users — Create a user. */
app.post('/admin/users', async (c) => {
  const repos = c.get('repos')
  const body = await readJson(c)
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return c.json({ error: 'username and password are required' }, 400)
  }
  if (await repos.users.getByUsername(username.toLowerCase())) {
    return c.json({ error: 'username already exists' }, 409)
  }

  const user = await repos.users.create({
    username,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    passwordHash: await hashPassword(password),
    role: parseRole(body.role) ?? 'member',
  })
  return c.json(toUserView(user), 200)
})

/** PATCH /web/admin/users/:id — Update role, disabled state, display name, or password. */
app.patch('/admin/users/:id', async (c) => {
  const repos = c.get('repos')
  const target = await repos.users.getById(c.req.param('id'))
  if (!target) return c.json({ error: 'user not found' }, 404)

  const body = await readJson(c)
  const role = parseRole(body.role)
  if (body.role !== undefined && role === undefined) {
    return c.json({ error: 'invalid role' }, 400)
  }
  const disabled = typeof body.disabled === 'boolean' ? body.disabled : undefined
  const displayName = typeof body.displayName === 'string' ? body.displayName : undefined
  const password = typeof body.password === 'string' && body.password ? body.password : undefined

  const targetIsEnabledAdmin = target.role === 'admin' && target.disabledAt === null
  const losesAdmin = role !== undefined && role !== 'admin'
  const disables = disabled === true
  if (targetIsEnabledAdmin && (losesAdmin || disables)) {
    if ((await otherEnabledAdmins(repos, target.id)) === 0) {
      return c.json({ error: 'cannot demote or disable the last enabled admin' }, 409)
    }
  }

  const patch: UserPatch = {}
  if (role !== undefined) patch.role = role
  if (displayName !== undefined) patch.displayName = displayName
  if (Object.keys(patch).length > 0) await repos.users.update(target.id, patch)
  if (disabled !== undefined) await repos.users.setDisabled(target.id, disabled ? new Date() : null)
  if (password !== undefined) await repos.users.setPasswordHash(target.id, await hashPassword(password))

  const updated = await repos.users.getById(target.id)
  return c.json(toUserView(updated ?? target), 200)
})

export default app
