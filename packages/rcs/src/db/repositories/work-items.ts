/**
 * Work-item repository: Postgres (Drizzle) implementation.
 *
 * Items move `pending → dispatched → acked → completed`. `claimNext` is the dispatch
 * primitive: it selects the oldest pending row inside a transaction with
 * `FOR UPDATE SKIP LOCKED`, so concurrent polls from one environment never deliver the
 * same item twice (other pollers skip the locked row instead of blocking).
 *
 * A dispatched item is a lease: its `updatedAt` is the last delivery or heartbeat. Poll
 * passing `reclaimOlderThanMs` returns leases older than that window to `pending` in the
 * same transaction, so a worker that lost its ack (stale ingress token) is re-delivered.
 *
 * A session has at most one in-flight (`pending`/`dispatched`) item — enforced by a
 * partial unique index — so re-dispatching on reconnect refreshes that row's secret
 * instead of stacking a duplicate the worker could launch twice.
 */

import { and, asc, eq, lt, sql } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { workItems } from '@/db/schema'

import type { WorkItemRepository } from './types'

export function createWorkItemRepository(db: Database): WorkItemRepository {
  return {
    async enqueue(input) {
      const now = new Date()
      // One in-flight item per session: the bridge re-dispatches every idle session on
      // reconnect, so an existing pending/dispatched row absorbs the new secret (fresh
      // worker token) instead of stacking a duplicate the worker could launch twice.
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
        .onConflictDoUpdate({
          target: workItems.sessionId,
          targetWhere: sql`state IN ('pending', 'dispatched')`,
          set: { secret: input.secret, updatedAt: now },
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
