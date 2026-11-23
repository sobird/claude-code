/**
 * User repository: Postgres (Drizzle) implementation.
 *
 * Usernames are stored lowercase (`create` normalizes before writing). `getByUsername`
 * performs an exact lookup on the stored value, so callers must pass the normalized
 * username; an uppercase lookup against a lowercase-only database returns `null`.
 */

import { and, asc, count, eq, isNull } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { users } from '@/db/schema'

import type { GuardedUserPatch, GuardedUserUpdateResult, UserRepository } from './types'

export function createUserRepository(db: Database): UserRepository {
  return {
    async create(input) {
      const now = new Date()
      const [row] = await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username: input.username.toLowerCase(),
          displayName: input.displayName ?? null,
          passwordHash: input.passwordHash,
          role: input.role,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return row
    },

    async getById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      return row ?? null
    },

    async getByUsername(username) {
      const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1)
      return row ?? null
    },

    async count() {
      const [row] = await db.select({ value: count() }).from(users)
      return row.value
    },

    async list() {
      return db.select().from(users).orderBy(asc(users.createdAt), asc(users.username))
    },

    async update(id, patch) {
      const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
      if (patch.role !== undefined) values.role = patch.role
      if (patch.displayName !== undefined) values.displayName = patch.displayName
      if (patch.locale !== undefined) values.locale = patch.locale
      await db.update(users).set(values).where(eq(users.id, id))
    },

    async updateGuarded(id: string, patch: GuardedUserPatch): Promise<GuardedUserUpdateResult> {
      const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
      if (patch.role !== undefined) values.role = patch.role
      if (patch.displayName !== undefined) values.displayName = patch.displayName
      if (patch.disabledAt !== undefined) values.disabledAt = patch.disabledAt

      // Only a write that demotes or disables can remove the last enabled admin.
      const mayRemoveAdmin = (patch.role !== undefined && patch.role !== 'admin') || patch.disabledAt instanceof Date

      return db.transaction(async (tx) => {
        // Lock every enabled admin row: a concurrent demotion blocks here until the
        // first commits, then re-reads the new set and sees no spare admin. A bare
        // conditional UPDATE would let both transactions observe the other admin.
        const enabledAdmins = mayRemoveAdmin
          ? await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
              .for('update')
          : []

        const targetIsEnabledAdmin = enabledAdmins.some((admin) => admin.id === id)
        if (targetIsEnabledAdmin && enabledAdmins.length === 1) {
          return { updated: false, reason: 'last_admin' } as const
        }

        const rows = await tx.update(users).set(values).where(eq(users.id, id)).returning()
        return rows.length > 0 ? ({ updated: true } as const) : ({ updated: false, reason: 'not_found' } as const)
      })
    },

    async setDisabled(id, disabledAt) {
      await db.update(users).set({ disabledAt, updatedAt: new Date() }).where(eq(users.id, id))
    },

    async setPasswordHash(id, hash) {
      await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, id))
    },
  }
}
