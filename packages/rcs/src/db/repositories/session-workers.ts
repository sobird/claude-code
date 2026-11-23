/**
 * Session-worker repository: Postgres (Drizzle) implementation.
 *
 * One worker row per session. `upsert` inserts when missing and otherwise merges the
 * patch: `externalMetadata` object patches are shallow-merged into the stored value
 * (`null` clears it), matching the legacy worker heartbeat protocol.
 */

import { eq, inArray, sql } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { sessionWorkers } from '@/db/schema'

import type { SessionWorkerRepository } from './types'

export function createSessionWorkerRepository(db: Database): SessionWorkerRepository {
  return {
    async get(sessionId) {
      const [row] = await db.select().from(sessionWorkers).where(eq(sessionWorkers.sessionId, sessionId)).limit(1)
      return row ?? null
    },

    async listBySessionIds(sessionIds) {
      if (sessionIds.length === 0) return []
      return db
        .select()
        .from(sessionWorkers)
        .where(inArray(sessionWorkers.sessionId, [...sessionIds]))
    },

    async upsert(sessionId, patch) {
      const now = new Date()
      // No read-modify-write: a heartbeat and a status update arriving together would each
      // write back a stale snapshot and clobber the other. Only the provided columns are
      // touched, and `external_metadata` merges inside the statement.
      const [row] = await db
        .insert(sessionWorkers)
        .values({
          sessionId,
          workerStatus: patch.workerStatus ?? null,
          externalMetadata: patch.externalMetadata ?? null,
          requiresActionDetails: patch.requiresActionDetails ?? null,
          lastHeartbeatAt: patch.lastHeartbeatAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: sessionWorkers.sessionId,
          set: {
            updatedAt: now,
            ...(patch.workerStatus !== undefined ? { workerStatus: patch.workerStatus } : {}),
            ...(patch.requiresActionDetails !== undefined
              ? { requiresActionDetails: patch.requiresActionDetails }
              : {}),
            ...(patch.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: patch.lastHeartbeatAt } : {}),
            ...(patch.externalMetadata !== undefined
              ? {
                  externalMetadata:
                    patch.externalMetadata === null
                      ? null
                      : sql`COALESCE(${sessionWorkers.externalMetadata}, '{}'::jsonb) || ${JSON.stringify(
                          patch.externalMetadata,
                        )}::jsonb`,
                }
              : {}),
          },
        })
        .returning()
      return row
    },
  }
}
