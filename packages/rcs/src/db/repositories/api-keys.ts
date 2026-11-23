/**
 * API-key repository: Postgres (Drizzle) implementation.
 *
 * Only the sha256 hash and display prefix are stored; raw keys never reach this layer.
 * `getByHash` returns revoked keys as well, so callers can distinguish "unknown key"
 * from "revoked key".
 */

import { asc, eq } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { apiKeys } from '@/db/schema'

import type { ApiKeyRepository } from './types'

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
