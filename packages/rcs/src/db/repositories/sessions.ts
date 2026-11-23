/**
 * Session repository: Postgres (Drizzle) implementation.
 *
 * `claimUnowned` is a single conditional update (`… WHERE owner_user_id IS NULL`) so
 * exactly one concurrent caller can claim a legacy unowned session. Listings skip
 * archived rows unless the caller passes `includeArchived`.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { SessionRecord } from '@/contracts'
import type { Database } from '@/db/client'
import { sessions } from '@/db/schema'

import type { SessionListOptions, SessionRepository } from './types'

export function createSessionRepository(db: Database): SessionRepository {
  return {
    async create(input) {
      const now = new Date()
      const [row] = await db
        .insert(sessions)
        .values({
          id: input.id ?? `cse_${crypto.randomUUID()}`,
          environmentId: input.environmentId ?? null,
          ownerUserId: input.ownerUserId ?? null,
          title: input.title ?? null,
          status: input.status ?? 'idle',
          source: input.source ?? 'remote-control',
          permissionMode: input.permissionMode ?? null,
          workerEpoch: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return row
    },

    async getById(id) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
      return row ?? null
    },

    async listByOwner(userId, options) {
      return listSessions(db, [eq(sessions.ownerUserId, userId)], options)
    },

    async listByEnvironment(environmentId, options) {
      return listSessions(db, [eq(sessions.environmentId, environmentId)], options)
    },

    async listUnowned(options) {
      return listSessions(db, [isNull(sessions.ownerUserId)], options)
    },

    async update(id, patch) {
      await db
        .update(sessions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(sessions.id, id))
    },

    async incrementEpoch(id) {
      const [row] = await db
        .update(sessions)
        .set({ workerEpoch: sql`${sessions.workerEpoch} + 1`, updatedAt: new Date() })
        .where(eq(sessions.id, id))
        .returning()
      if (!row) {
        throw new Error(`session not found: ${id}`)
      }
      return row.workerEpoch
    },

    async claimUnowned(sessionId, userId) {
      const claimed = await db
        .update(sessions)
        .set({ ownerUserId: userId, updatedAt: new Date() })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.ownerUserId)))
        .returning()
      return claimed.length > 0
    },

    async archive(id, at) {
      await db
        .update(sessions)
        .set({ archivedAt: at, status: 'archived', updatedAt: new Date() })
        .where(eq(sessions.id, id))
    },
  }
}

function listSessions(db: Database, conditions: SQL[], options?: SessionListOptions): Promise<SessionRecord[]> {
  const filters = options?.includeArchived ? conditions : [...conditions, isNull(sessions.archivedAt)]
  return db
    .select()
    .from(sessions)
    .where(and(...filters))
    .orderBy(asc(sessions.createdAt), asc(sessions.id))
}
