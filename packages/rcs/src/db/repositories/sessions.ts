/**
 * Session repository: Postgres (Drizzle) and in-memory implementations.
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

import type { CreateSessionInput, SessionListOptions, SessionPatch, SessionRepository } from './types'

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

function cloneSession(record: SessionRecord): SessionRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
  }
}

export function createMemorySessionRepository(): SessionRepository {
  const byId = new Map<string, SessionRecord>()

  function listMemorySessions(
    predicate: (record: SessionRecord) => boolean,
    options?: SessionListOptions,
  ): SessionRecord[] {
    return [...byId.values()]
      .filter((record) => predicate(record) && (options?.includeArchived || record.archivedAt === null))
      .map(cloneSession)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  }

  return {
    async create(input: CreateSessionInput) {
      const id = input.id ?? `cse_${crypto.randomUUID()}`
      if (byId.has(id)) {
        throw new Error(`session already exists: ${id}`)
      }
      const now = new Date()
      const record: SessionRecord = {
        id,
        environmentId: input.environmentId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        title: input.title ?? null,
        status: input.status ?? 'idle',
        source: input.source ?? 'remote-control',
        permissionMode: input.permissionMode ?? null,
        workerEpoch: 0,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      }
      byId.set(id, record)
      return cloneSession(record)
    },

    async getById(id) {
      const record = byId.get(id)
      return record ? cloneSession(record) : null
    },

    async listByOwner(userId, options) {
      return listMemorySessions((record) => record.ownerUserId === userId, options)
    },

    async listByEnvironment(environmentId, options) {
      return listMemorySessions((record) => record.environmentId === environmentId, options)
    },

    async listUnowned(options) {
      return listMemorySessions((record) => record.ownerUserId === null, options)
    },

    async update(id, patch: SessionPatch) {
      const record = byId.get(id)
      if (!record) return
      Object.assign(record, definedPatch(patch), { updatedAt: new Date() })
      record.archivedAt = record.archivedAt ? new Date(record.archivedAt) : null
    },

    async incrementEpoch(id) {
      const record = byId.get(id)
      if (!record) {
        throw new Error(`session not found: ${id}`)
      }
      record.workerEpoch += 1
      record.updatedAt = new Date()
      return record.workerEpoch
    },

    async claimUnowned(sessionId, userId) {
      // No `await` between the check and the write, so this is synchronous-atomic.
      const record = byId.get(sessionId)
      if (!record || record.ownerUserId !== null) return false
      record.ownerUserId = userId
      record.updatedAt = new Date()
      return true
    },

    async archive(id, at) {
      const record = byId.get(id)
      if (!record) return
      record.archivedAt = new Date(at)
      record.status = 'archived'
      record.updatedAt = new Date()
    },
  }
}

/** Drop `undefined` entries so a partial patch never erases stored values. */
function definedPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
}
