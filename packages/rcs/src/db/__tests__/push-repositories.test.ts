import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createMemoryUserRepositories, createUserRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories'
import { users } from '@/db/schema'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

function suite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    let repos: Repositories
    beforeEach(() => {
      repos = makeRepos()
    })

    test('upserting the same endpoint updates the row instead of adding one', async () => {
      const user = await repos.users.create({ username: 'push-a', passwordHash: 'x', role: 'member' })
      const first = await repos.pushSubscriptions.upsertForUser(user.id, {
        endpoint: 'https://e/1',
        p256dh: 'k1',
        auth: 'a1',
      })
      const second = await repos.pushSubscriptions.upsertForUser(user.id, {
        endpoint: 'https://e/1',
        p256dh: 'k2',
        auth: 'a2',
        userAgent: 'UA',
      })

      expect(second.id).toBe(first.id)
      expect(second.p256dh).toBe('k2')
      expect(second.userAgent).toBe('UA')
      expect(await repos.pushSubscriptions.listByUser(user.id)).toHaveLength(1)
    })

    test('re-registering an endpoint under another user moves it', async () => {
      const one = await repos.users.create({ username: 'push-b1', passwordHash: 'x', role: 'member' })
      const two = await repos.users.create({ username: 'push-b2', passwordHash: 'x', role: 'member' })
      await repos.pushSubscriptions.upsertForUser(one.id, { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })
      await repos.pushSubscriptions.upsertForUser(two.id, { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })

      expect(await repos.pushSubscriptions.listByUser(one.id)).toHaveLength(0)
      expect(await repos.pushSubscriptions.listByUser(two.id)).toHaveLength(1)
    })

    test('keeps at most ten subscriptions per user, evicting the oldest', async () => {
      const user = await repos.users.create({ username: 'push-cap', passwordHash: 'x', role: 'member' })
      for (let i = 0; i < 11; i += 1) {
        await repos.pushSubscriptions.upsertForUser(user.id, {
          endpoint: `https://e/cap-${i}`,
          p256dh: 'k',
          auth: 'a',
        })
      }
      const list = await repos.pushSubscriptions.listByUser(user.id)
      expect(list).toHaveLength(10)
      // The newest survives; tie-breaking on same-microsecond timestamps is not pinned.
      expect(list.some((row) => row.endpoint === 'https://e/cap-10')).toBe(true)
    })

    test('deleteByEndpoint only deletes the given user’s row', async () => {
      const owner = await repos.users.create({ username: 'push-del1', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'push-del2', passwordHash: 'x', role: 'member' })
      await repos.pushSubscriptions.upsertForUser(owner.id, { endpoint: 'https://e/d', p256dh: 'k', auth: 'a' })
      await repos.pushSubscriptions.upsertForUser(other.id, { endpoint: 'https://e/d2', p256dh: 'k', auth: 'a' })

      await repos.pushSubscriptions.deleteByEndpoint(owner.id, 'https://e/d2')
      expect(await repos.pushSubscriptions.listByUser(owner.id)).toHaveLength(1)
      await repos.pushSubscriptions.deleteByEndpoint(owner.id, 'https://e/d')
      expect(await repos.pushSubscriptions.listByUser(owner.id)).toHaveLength(0)
      expect(await repos.pushSubscriptions.listByUser(other.id)).toHaveLength(1)
    })

    test('push settings round-trip', async () => {
      expect(await repos.pushSettings.get()).toBeNull()
      await repos.pushSettings.set({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' })
      expect(await repos.pushSettings.get()).toEqual({
        publicKey: 'pub',
        privateKey: 'priv',
        subject: 'mailto:a@b.c',
      })
      await repos.pushSettings.set({ publicKey: 'pub2', privateKey: 'priv2', subject: 'mailto:a@b.c' })
      expect((await repos.pushSettings.get())?.publicKey).toBe('pub2')
    })
  })
}

suite('postgres', () => createUserRepositories(ctx.db))
suite('memory', () => createMemoryUserRepositories())

test('deleting a user cascades to their subscriptions', async () => {
  const repos = createUserRepositories(ctx.db)
  const user = await repos.users.create({ username: 'push-cascade', passwordHash: 'x', role: 'member' })
  await repos.pushSubscriptions.upsertForUser(user.id, { endpoint: 'https://e/cascade', p256dh: 'k', auth: 'a' })

  await ctx.db.delete(users).where(eq(users.id, user.id))

  expect(await repos.pushSubscriptions.listByUser(user.id)).toHaveLength(0)
})
