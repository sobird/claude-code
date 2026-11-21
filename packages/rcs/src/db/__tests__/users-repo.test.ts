import { afterAll, describe, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createMemoryUserRepositories, createUserRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

/**
 * Both implementations must satisfy the same assertions. Each test builds its own
 * handles: the Postgres half shares the migrated PGlite database, so usernames and
 * token hashes are unique per test.
 */
function repositorySuite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    test('create and look up a user by normalized username', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'alice', passwordHash: 'x', role: 'member' })
      expect((await repos.users.getByUsername('alice'))?.id).toBe(user.id)
      expect(await repos.users.getByUsername('ALICE')).toBeNull()
    })

    test('revoked API key lookup still resolves but reports revocation', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'bob', passwordHash: 'x', role: 'member' })
      const key = await repos.apiKeys.create({ userId: user.id, name: 'cli', prefix: 'rcs_abc', hash: 'h1' })
      await repos.apiKeys.revoke(key.id, new Date())
      const found = await repos.apiKeys.getByHash('h1')
      expect(found?.revokedAt).toBeInstanceOf(Date)
    })

    test('create lowercases the username and preserves profile fields', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({
        username: 'MiXeD-Case',
        displayName: 'Mixed Case',
        passwordHash: 'hash',
        role: 'admin',
      })
      expect(user.username).toBe('mixed-case')
      expect(user.displayName).toBe('Mixed Case')
      expect(user.passwordHash).toBe('hash')
      expect(user.role).toBe('admin')
      expect(user.disabledAt).toBeNull()
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user.updatedAt).toBeInstanceOf(Date)

      expect((await repos.users.getByUsername('mixed-case'))?.id).toBe(user.id)
      expect(await repos.users.getByUsername('MiXeD-Case')).toBeNull()
    })

    test('displayName defaults to null', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'no-display', passwordHash: 'x', role: 'member' })
      expect(user.displayName).toBeNull()
    })

    test('count and list include created users', async () => {
      const repos = makeRepos()
      const before = await repos.users.count()
      const carol = await repos.users.create({ username: 'carol', passwordHash: 'x', role: 'member' })
      const dave = await repos.users.create({ username: 'dave', passwordHash: 'x', role: 'member' })

      expect(await repos.users.count()).toBe(before + 2)
      const ids = (await repos.users.list()).map((user) => user.id)
      expect(ids).toContain(carol.id)
      expect(ids).toContain(dave.id)
    })

    test('getById returns null for unknown ids', async () => {
      const repos = makeRepos()
      expect(await repos.users.getById(crypto.randomUUID())).toBeNull()
    })

    test('setDisabled sets and clears the disabled timestamp', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'erin', passwordHash: 'x', role: 'member' })
      const disabledAt = new Date('2026-01-02T03:04:05.000Z')

      await repos.users.setDisabled(user.id, disabledAt)
      const disabled = await repos.users.getById(user.id)
      expect(disabled?.disabledAt?.getTime()).toBe(disabledAt.getTime())
      expect(disabled?.updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime())

      await repos.users.setDisabled(user.id, null)
      expect((await repos.users.getById(user.id))?.disabledAt).toBeNull()
    })

    test('updateGuarded applies profile and disabled state in one call', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'guarded-profile', passwordHash: 'x', role: 'member' })
      const disabledAt = new Date('2026-03-04T05:06:07.000Z')

      const result = await repos.users.updateGuarded(user.id, {
        displayName: 'Renamed',
        disabledAt,
      })
      expect(result).toEqual({ updated: true })

      const updated = await repos.users.getById(user.id)
      expect(updated?.displayName).toBe('Renamed')
      expect(updated?.disabledAt?.getTime()).toBe(disabledAt.getTime())

      expect(await repos.users.updateGuarded(user.id, { disabledAt: null })).toEqual({ updated: true })
      expect((await repos.users.getById(user.id))?.disabledAt).toBeNull()
    })

    test('updateGuarded reports not_found for unknown ids', async () => {
      const repos = makeRepos()
      expect(await repos.users.updateGuarded(crypto.randomUUID(), { displayName: 'nobody' })).toEqual({
        updated: false,
        reason: 'not_found',
      })
    })

    test('updateGuarded demotes an admin while another enabled admin remains', async () => {
      const repos = makeRepos()
      const first = await repos.users.create({ username: 'guarded-admin-a', passwordHash: 'x', role: 'admin' })
      await repos.users.create({ username: 'guarded-admin-b', passwordHash: 'x', role: 'admin' })

      expect(await repos.users.updateGuarded(first.id, { role: 'member' })).toEqual({ updated: true })
      expect((await repos.users.getById(first.id))?.role).toBe('member')
    })

    test('concurrent demotions cannot remove every admin', async () => {
      const repos = makeRepos()
      for (const user of await repos.users.list()) {
        if (user.role === 'admin' && user.disabledAt === null) {
          await repos.users.setDisabled(user.id, new Date())
        }
      }
      const first = await repos.users.create({ username: 'guarded-race-a', passwordHash: 'x', role: 'admin' })
      const second = await repos.users.create({ username: 'guarded-race-b', passwordHash: 'x', role: 'admin' })

      const results = await Promise.all([
        repos.users.updateGuarded(first.id, { role: 'member' }),
        repos.users.updateGuarded(second.id, { role: 'member' }),
      ])

      expect(results.filter((result) => result.updated)).toHaveLength(1)
      const enabledAdmins = (await repos.users.list()).filter(
        (user) => user.role === 'admin' && user.disabledAt === null,
      )
      expect(enabledAdmins).toHaveLength(1)
    })

    test('updateGuarded refuses to demote or disable the last enabled admin', async () => {
      const repos = makeRepos()
      // The PGlite suite shares one database, so retire every other enabled admin
      // first and make this user the only one.
      for (const user of await repos.users.list()) {
        if (user.role === 'admin' && user.disabledAt === null) {
          await repos.users.setDisabled(user.id, new Date())
        }
      }
      const soleAdmin = await repos.users.create({ username: 'guarded-sole-admin', passwordHash: 'x', role: 'admin' })

      expect(await repos.users.updateGuarded(soleAdmin.id, { role: 'member' })).toEqual({
        updated: false,
        reason: 'last_admin',
      })
      expect(await repos.users.updateGuarded(soleAdmin.id, { disabledAt: new Date() })).toEqual({
        updated: false,
        reason: 'last_admin',
      })

      // Unrelated profile edits still go through.
      expect(await repos.users.updateGuarded(soleAdmin.id, { displayName: 'Still Admin' })).toEqual({ updated: true })
      const reloaded = await repos.users.getById(soleAdmin.id)
      expect(reloaded?.role).toBe('admin')
      expect(reloaded?.disabledAt).toBeNull()
      expect(reloaded?.displayName).toBe('Still Admin')
    })

    test('setPasswordHash replaces the stored hash', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'frank', passwordHash: 'old', role: 'member' })
      await repos.users.setPasswordHash(user.id, 'new-hash')
      expect((await repos.users.getById(user.id))?.passwordHash).toBe('new-hash')
    })

    test('duplicate usernames are rejected', async () => {
      const repos = makeRepos()
      await repos.users.create({ username: 'henry', passwordHash: 'x', role: 'member' })
      let error: unknown
      try {
        await repos.users.create({ username: 'HENRY', passwordHash: 'y', role: 'member' })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(Error)
    })

    test('API keys store prefix and hash under contract field names', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'iris', passwordHash: 'x', role: 'member' })
      const key = await repos.apiKeys.create({ userId: user.id, name: 'cli', prefix: 'rcs_pfx', hash: 'hash-iris' })

      expect(key.userId).toBe(user.id)
      expect(key.name).toBe('cli')
      expect(key.tokenPrefix).toBe('rcs_pfx')
      expect(key.tokenHash).toBe('hash-iris')
      expect(key.lastUsedAt).toBeNull()
      expect(key.revokedAt).toBeNull()
      expect(key.createdAt).toBeInstanceOf(Date)
    })

    test('getByHash returns null for unknown hashes', async () => {
      const repos = makeRepos()
      expect(await repos.apiKeys.getByHash('nope')).toBeNull()
    })

    test('touch records the last used time', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'jane', passwordHash: 'x', role: 'member' })
      const key = await repos.apiKeys.create({ userId: user.id, name: 'cli', prefix: 'rcs_j', hash: 'hash-jane' })

      await repos.apiKeys.touch(key.id)
      const touched = await repos.apiKeys.getByHash('hash-jane')
      expect(touched?.lastUsedAt).toBeInstanceOf(Date)
    })

    test('listByUser scopes keys to the user and includes revoked keys', async () => {
      const repos = makeRepos()
      const owner = await repos.users.create({ username: 'kim', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'lee', passwordHash: 'x', role: 'member' })
      const first = await repos.apiKeys.create({ userId: owner.id, name: 'cli', prefix: 'rcs_k1', hash: 'hash-kim-1' })
      const second = await repos.apiKeys.create({ userId: owner.id, name: 'ci', prefix: 'rcs_k2', hash: 'hash-kim-2' })
      await repos.apiKeys.create({ userId: other.id, name: 'cli', prefix: 'rcs_l1', hash: 'hash-lee-1' })
      await repos.apiKeys.revoke(second.id, new Date())

      const keys = await repos.apiKeys.listByUser(owner.id)
      expect(keys.map((key) => key.id).toSorted()).toEqual([first.id, second.id].toSorted())
      expect((await repos.apiKeys.listByUser(other.id)).length).toBe(1)
    })

    test('revoke records the revocation timestamp', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'mo', passwordHash: 'x', role: 'member' })
      const key = await repos.apiKeys.create({ userId: user.id, name: 'cli', prefix: 'rcs_m', hash: 'hash-mo' })
      const revokedAt = new Date('2026-02-03T04:05:06.000Z')

      await repos.apiKeys.revoke(key.id, revokedAt)
      const revoked = await repos.apiKeys.getByHash('hash-mo')
      expect(revoked?.revokedAt?.getTime()).toBe(revokedAt.getTime())
    })

    test('locale defaults to null and can be set or cleared', async () => {
      const repos = makeRepos()
      const user = await repos.users.create({ username: 'locale-user', passwordHash: 'x', role: 'member' })
      expect(user.locale).toBeNull()
      await repos.users.update(user.id, { locale: 'zh-CN' })
      expect((await repos.users.getById(user.id))?.locale).toBe('zh-CN')
      await repos.users.update(user.id, { locale: null })
      expect((await repos.users.getById(user.id))?.locale).toBeNull()
    })
  })
}

repositorySuite('UserRepository (PGlite)', () => createUserRepositories(ctx.db))
repositorySuite('UserRepository (memory)', () => createMemoryUserRepositories())
