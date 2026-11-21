/**
 * API-key repository: Postgres (Drizzle) and in-memory implementations.
 *
 * Only the sha256 hash and display prefix are stored; raw keys never reach this layer.
 * `getByHash` returns revoked keys as well, so callers can distinguish "unknown key"
 * from "revoked key".
 */

import { asc, eq } from 'drizzle-orm'

import type { ApiKeyRecord } from '@/contracts'
import type { Database } from '@/db/client'
import { apiKeys } from '@/db/schema'

import type { ApiKeyRepository, CreateApiKeyInput } from './types'

export function createApiKeyRepository(db: Database): ApiKeyRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(apiKeys)
        .values({
          id: crypto.randomUUID(),
          userId: input.userId,
          name: input.name,
          tokenPrefix: input.prefix,
          tokenHash: input.hash,
          createdAt: new Date(),
        })
        .returning()
      return row
    },

    async getByHash(hash) {
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.tokenHash, hash)).limit(1)
      return row ?? null
    },

    async touch(id) {
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id))
    },

    async revoke(id, at) {
      await db.update(apiKeys).set({ revokedAt: at }).where(eq(apiKeys.id, id))
    },

    async listByUser(userId) {
      return db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id))
    },
  }
}

function cloneApiKey(record: ApiKeyRecord): ApiKeyRecord {
  return {
    ...record,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    createdAt: new Date(record.createdAt),
  }
}

export function createMemoryApiKeyRepository(): ApiKeyRepository {
  const byId = new Map<string, ApiKeyRecord>()
  const idByHash = new Map<string, string>()

  return {
    async create(input: CreateApiKeyInput) {
      if (idByHash.has(input.hash)) {
        throw new Error(`token hash already exists: ${input.hash}`)
      }
      const record: ApiKeyRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        name: input.name,
        tokenPrefix: input.prefix,
        tokenHash: input.hash,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      }
      byId.set(record.id, record)
      idByHash.set(record.tokenHash, record.id)
      return cloneApiKey(record)
    },

    async getByHash(hash) {
      const id = idByHash.get(hash)
      if (!id) return null
      const record = byId.get(id)
      return record ? cloneApiKey(record) : null
    },

    async touch(id) {
      const record = byId.get(id)
      if (!record) return
      record.lastUsedAt = new Date()
    },

    async revoke(id, at) {
      const record = byId.get(id)
      if (!record) return
      record.revokedAt = new Date(at)
    },

    async listByUser(userId) {
      return [...byId.values()]
        .filter((record) => record.userId === userId)
        .map(cloneApiKey)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    },
  }
}
