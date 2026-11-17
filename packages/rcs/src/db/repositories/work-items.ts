/**
 * Work-item repository: Postgres (Drizzle) and in-memory implementations.
 *
 * Items move `pending → dispatched → acked → completed`. `claimNext` is the dispatch
 * primitive: it selects the oldest pending row inside a transaction with
 * `FOR UPDATE SKIP LOCKED`, so concurrent polls from one environment never deliver the
 * same item twice (other pollers skip the locked row instead of blocking).
 *
 * A dispatched item is a lease: its `updatedAt` is the last delivery or heartbeat. Poll
 * passing `reclaimOlderThanMs` returns leases older than that window to `pending` in the
 * same transaction, so a worker that lost its ack (stale ingress token) is re-delivered.
 */

import { and, asc, eq, lt } from 'drizzle-orm'

import type { WorkItemRecord } from '../../contracts'
import type { Database } from '../client'
import { workItems } from '../schema'
import type { EnqueueWorkItemInput, WorkItemRepository } from './types'

export function createWorkItemRepository(db: Database): WorkItemRepository {
  return {
    async enqueue(input) {
      const now = new Date()
      const [row] = await db
        .insert(workItems)
        .values({
          id: `work_${crypto.randomUUID()}`,
          environmentId: input.environmentId,
          sessionId: input.sessionId,
          state: 'pending',
          secret: input.secret,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return row
    },

    async claimNext(environmentId, options) {
      const reclaimOlderThanMs = options?.reclaimOlderThanMs
      return db.transaction(async (tx) => {
        if (reclaimOlderThanMs !== undefined && Number.isFinite(reclaimOlderThanMs) && reclaimOlderThanMs > 0) {
          // Runs before the select, inside the same transaction: leases made stale by a
          // missed ack/heartbeat go back to `pending` and are eligible for this claim.
          await tx
            .update(workItems)
            .set({ state: 'pending', updatedAt: new Date() })
            .where(
              and(
                eq(workItems.environmentId, environmentId),
                eq(workItems.state, 'dispatched'),
                lt(workItems.updatedAt, new Date(Date.now() - reclaimOlderThanMs)),
              ),
            )
        }

        const [candidate] = await tx
          .select()
          .from(workItems)
          .where(and(eq(workItems.environmentId, environmentId), eq(workItems.state, 'pending')))
          .orderBy(asc(workItems.createdAt), asc(workItems.id))
          .limit(1)
          .for('update', { skipLocked: true })
        if (!candidate) return null

        const [row] = await tx
          .update(workItems)
          .set({ state: 'dispatched', updatedAt: new Date() })
          .where(eq(workItems.id, candidate.id))
          .returning()
        return row ?? null
      })
    },

    async getById(id) {
      const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
      return row ?? null
    },

    async setState(id, state) {
      await db.update(workItems).set({ state, updatedAt: new Date() }).where(eq(workItems.id, id))
    },

    async bump(id) {
      await db.update(workItems).set({ updatedAt: new Date() }).where(eq(workItems.id, id))
    },
  }
}

function cloneWorkItem(record: WorkItemRecord): WorkItemRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function createMemoryWorkItemRepository(): WorkItemRepository {
  const byId = new Map<string, WorkItemRecord>()

  return {
    async enqueue(input: EnqueueWorkItemInput) {
      const now = new Date()
      const record: WorkItemRecord = {
        id: `work_${crypto.randomUUID()}`,
        environmentId: input.environmentId,
        sessionId: input.sessionId,
        state: 'pending',
        secret: input.secret,
        createdAt: now,
        updatedAt: now,
      }
      byId.set(record.id, record)
      return cloneWorkItem(record)
    },

    async claimNext(environmentId, options) {
      const reclaimOlderThanMs = options?.reclaimOlderThanMs
      if (reclaimOlderThanMs !== undefined && Number.isFinite(reclaimOlderThanMs) && reclaimOlderThanMs > 0) {
        const cutoff = Date.now() - reclaimOlderThanMs
        for (const record of byId.values()) {
          if (
            record.environmentId === environmentId &&
            record.state === 'dispatched' &&
            record.updatedAt.getTime() < cutoff
          ) {
            record.state = 'pending'
            record.updatedAt = new Date()
          }
        }
      }

      // No `await` between the scan and the write, so this is synchronous-atomic.
      const candidate = [...byId.values()]
        .filter((record) => record.environmentId === environmentId && record.state === 'pending')
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0]
      if (!candidate) return null

      candidate.state = 'dispatched'
      candidate.updatedAt = new Date()
      return cloneWorkItem(candidate)
    },

    async getById(id) {
      const record = byId.get(id)
      return record ? cloneWorkItem(record) : null
    },

    async setState(id, state) {
      const record = byId.get(id)
      if (!record) return
      record.state = state
      record.updatedAt = new Date()
    },

    async bump(id) {
      const record = byId.get(id)
      if (!record) return
      record.updatedAt = new Date()
    },
  }
}
