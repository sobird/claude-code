/**
 * User repository: Postgres (Drizzle) and in-memory implementations.
 *
 * Usernames are stored lowercase (`create` normalizes before writing). `getByUsername`
 * performs an exact lookup on the stored value, so callers must pass the normalized
 * username; an uppercase lookup against a lowercase-only database returns `null`.
 */

import { asc, count, eq } from 'drizzle-orm'

import type { UserRecord } from '../../contracts.js'
import type { Database } from '../client.js'
import { users } from '../schema.js'
import type { CreateUserInput, UserRepository } from './types.js'

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
