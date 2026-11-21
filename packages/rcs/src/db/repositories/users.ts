/**
 * User repository: Postgres (Drizzle) and in-memory implementations.
 *
 * Usernames are stored lowercase (`create` normalizes before writing). `getByUsername`
 * performs an exact lookup on the stored value, so callers must pass the normalized
 * username; an uppercase lookup against a lowercase-only database returns `null`.
 */

import { and, asc, count, eq, isNull } from 'drizzle-orm'

import type { UserRecord } from '@/contracts'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'

import type { CreateUserInput, GuardedUserPatch, GuardedUserUpdateResult, UserPatch, UserRepository } from './types'

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

function cloneUser(record: UserRecord): UserRecord {
  return {
    ...record,
    disabledAt: record.disabledAt ? new Date(record.disabledAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function createMemoryUserRepository(): UserRepository {
  const byId = new Map<string, UserRecord>()
  const idByUsername = new Map<string, string>()

  return {
    async create(input: CreateUserInput) {
      const username = input.username.toLowerCase()
      if (idByUsername.has(username)) {
        throw new Error(`username already exists: ${username}`)
      }
      const now = new Date()
      const record: UserRecord = {
        id: crypto.randomUUID(),
        username,
        displayName: input.displayName ?? null,
        passwordHash: input.passwordHash,
        role: input.role,
        locale: null,
        disabledAt: null,
        createdAt: now,
        updatedAt: now,
      }
      byId.set(record.id, record)
      idByUsername.set(username, record.id)
      return cloneUser(record)
    },

    async getById(id) {
      const record = byId.get(id)
      return record ? cloneUser(record) : null
    },

    async getByUsername(username) {
      const id = idByUsername.get(username)
      if (!id) return null
      const record = byId.get(id)
      return record ? cloneUser(record) : null
    },

    async count() {
      return byId.size
    },

    async list() {
      return [...byId.values()]
        .map(cloneUser)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.username.localeCompare(b.username))
    },

    async update(id: string, patch: UserPatch) {
      const record = byId.get(id)
      if (!record) return
      if (patch.role !== undefined) record.role = patch.role
      if (patch.displayName !== undefined) record.displayName = patch.displayName
      if (patch.locale !== undefined) record.locale = patch.locale
      record.updatedAt = new Date()
    },

    async updateGuarded(id: string, patch: GuardedUserPatch): Promise<GuardedUserUpdateResult> {
      const record = byId.get(id)
      if (!record) return { updated: false, reason: 'not_found' }

      // Check and write run synchronously (no awaits) so the guard is atomic on the
      // single-threaded event loop, mirroring the SQL implementation's row lock.
      const leavesAdmin = patch.role !== undefined && patch.role !== 'admin'
      const disables = patch.disabledAt instanceof Date
      const wasEnabledAdmin = record.role === 'admin' && record.disabledAt === null
      if (wasEnabledAdmin && (leavesAdmin || disables)) {
        const anotherEnabledAdmin = [...byId.values()].some(
          (other) => other.id !== id && other.role === 'admin' && other.disabledAt === null,
        )
        if (!anotherEnabledAdmin) return { updated: false, reason: 'last_admin' }
      }

      if (patch.role !== undefined) record.role = patch.role
      if (patch.displayName !== undefined) record.displayName = patch.displayName
      if (patch.disabledAt !== undefined) record.disabledAt = patch.disabledAt
      record.updatedAt = new Date()
      return { updated: true }
    },

    async setDisabled(id, disabledAt) {
      const record = byId.get(id)
      if (!record) return
      record.disabledAt = disabledAt ? new Date(disabledAt) : null
      record.updatedAt = new Date()
    },

    async setPasswordHash(id, hash) {
      const record = byId.get(id)
      if (!record) return
      record.passwordHash = hash
      record.updatedAt = new Date()
    },
  }
}
