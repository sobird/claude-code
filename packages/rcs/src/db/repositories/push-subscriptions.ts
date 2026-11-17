/**
 * Web Push subscription repository: Postgres (Drizzle) and in-memory implementations.
 *
 * A subscription is keyed by its push-service `endpoint`, which is globally unique. An
 * upsert therefore updates the existing row and (re)assigns it to the calling user, so a
 * browser that signs in as another account on the same device moves rather than
 * duplicates. Each user is capped at `MAX_SUBSCRIPTIONS_PER_USER` endpoints; the oldest
 * rows beyond the cap are evicted on insert.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'

import type { PushSubscriptionRecord } from '../../contracts'
import type { Database } from '../client'
import { pushSubscriptions } from '../schema'
import type { CreatePushSubscriptionInput, PushSubscriptionRepository } from './types'

export const MAX_SUBSCRIPTIONS_PER_USER = 10

export function createPushSubscriptionRepository(db: Database): PushSubscriptionRepository {
  return {
    async upsertForUser(userId, input) {
      // Created/updated timestamps come from the column defaults on insert; the conflict
      // path bumps `updatedAt` without touching `createdAt`, so eviction order stays stable.
      const [row] = await db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
            updatedAt: new Date(),
          },
        })
        .returning()

      const rows = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
      if (rows.length > MAX_SUBSCRIPTIONS_PER_USER) {
        const excess = rows.slice(MAX_SUBSCRIPTIONS_PER_USER).map((subscription) => subscription.id)
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, excess))
      }

      return row
    },

    async listByUser(userId) {
      return db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
    },

    async deleteById(id) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
    },

    async deleteByEndpoint(userId, endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    },
  }
}

function clonePushSubscription(record: PushSubscriptionRecord): PushSubscriptionRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function createMemoryPushSubscriptionRepository(): PushSubscriptionRepository {
  const byId = new Map<string, PushSubscriptionRecord>()
  const idByEndpoint = new Map<string, string>()
  /** Insertion order, used to break same-millisecond `createdAt` ties deterministically. */
  const order = new Map<string, number>()
  let nextOrder = 0

  function remove(id: string): void {
    const record = byId.get(id)
    if (!record) return
    byId.delete(id)
    order.delete(id)
    if (idByEndpoint.get(record.endpoint) === id) idByEndpoint.delete(record.endpoint)
  }

  /** Newest first: `createdAt` descending, then insertion order descending. */
  function listRecords(userId: string): PushSubscriptionRecord[] {
    return [...byId.values()]
      .filter((record) => record.userId === userId)
      .toSorted(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0),
      )
  }

  function enforceCap(userId: string): void {
    for (const excess of listRecords(userId).slice(MAX_SUBSCRIPTIONS_PER_USER)) {
      remove(excess.id)
    }
  }

  return {
    async upsertForUser(userId, input: CreatePushSubscriptionInput) {
      const now = new Date()
      const existingId = idByEndpoint.get(input.endpoint)
      const existing = existingId ? byId.get(existingId) : undefined

      let record: PushSubscriptionRecord
      if (existing) {
        record = {
          ...existing,
          userId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
          updatedAt: now,
        }
        byId.set(existing.id, record)
      } else {
        record = {
          id: crypto.randomUUID(),
          userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
          createdAt: now,
          updatedAt: now,
        }
        byId.set(record.id, record)
        idByEndpoint.set(record.endpoint, record.id)
        order.set(record.id, nextOrder)
        nextOrder += 1
      }

      enforceCap(userId)
      return clonePushSubscription(record)
    },

    async listByUser(userId) {
      return listRecords(userId).map(clonePushSubscription)
    },

    async deleteById(id) {
      remove(id)
    },

    async deleteByEndpoint(userId, endpoint) {
      const id = idByEndpoint.get(endpoint)
      if (!id) return
      const record = byId.get(id)
      if (record?.userId === userId) remove(id)
    },
  }
}
