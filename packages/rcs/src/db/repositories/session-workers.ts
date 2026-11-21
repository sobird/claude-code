/**
 * Session-worker repository: Postgres (Drizzle) and in-memory implementations.
 *
 * One worker row per session. `upsert` inserts when missing and otherwise merges the
 * patch: `externalMetadata` object patches are shallow-merged into the stored value
 * (`null` clears it), matching the legacy worker heartbeat protocol.
 */

import { eq, sql } from 'drizzle-orm'

import type { SessionWorkerRecord } from '@/contracts'
import type { Database } from '@/db/client'
import { sessionWorkers } from '@/db/schema'

import type { SessionWorkerPatch, SessionWorkerRepository } from './types'

function mergeExternalMetadata(
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (patch === undefined) return existing
  if (patch === null) return null
  return { ...existing, ...patch }
}

export function createSessionWorkerRepository(db: Database): SessionWorkerRepository {
  return {
    async get(sessionId) {
      const [row] = await db.select().from(sessionWorkers).where(eq(sessionWorkers.sessionId, sessionId)).limit(1)
      return row ?? null
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

function cloneSessionWorker(record: SessionWorkerRecord): SessionWorkerRecord {
  return {
    ...record,
    externalMetadata: record.externalMetadata ? { ...record.externalMetadata } : null,
    requiresActionDetails: record.requiresActionDetails ? { ...record.requiresActionDetails } : null,
    lastHeartbeatAt: record.lastHeartbeatAt ? new Date(record.lastHeartbeatAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function createMemorySessionWorkerRepository(): SessionWorkerRepository {
  const bySessionId = new Map<string, SessionWorkerRecord>()

  return {
    async get(sessionId) {
      const record = bySessionId.get(sessionId)
      return record ? cloneSessionWorker(record) : null
    },

    async upsert(sessionId: string, patch: SessionWorkerPatch) {
      const now = new Date()
      const existing = bySessionId.get(sessionId)
      const record: SessionWorkerRecord = existing
        ? {
            ...existing,
            workerStatus: patch.workerStatus !== undefined ? patch.workerStatus : existing.workerStatus,
            externalMetadata: mergeExternalMetadata(existing.externalMetadata, patch.externalMetadata),
            requiresActionDetails:
              patch.requiresActionDetails !== undefined ? patch.requiresActionDetails : existing.requiresActionDetails,
            lastHeartbeatAt:
              patch.lastHeartbeatAt !== undefined
                ? patch.lastHeartbeatAt
                  ? new Date(patch.lastHeartbeatAt)
                  : null
                : existing.lastHeartbeatAt,
            updatedAt: now,
          }
        : {
            sessionId,
            workerStatus: patch.workerStatus ?? null,
            externalMetadata: patch.externalMetadata ? { ...patch.externalMetadata } : null,
            requiresActionDetails: patch.requiresActionDetails ? { ...patch.requiresActionDetails } : null,
            lastHeartbeatAt: patch.lastHeartbeatAt ? new Date(patch.lastHeartbeatAt) : null,
            createdAt: now,
            updatedAt: now,
          }

      bySessionId.set(sessionId, record)
      return cloneSessionWorker(record)
    },
  }
}
