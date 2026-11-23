/**
 * Web Push subscription repository: Postgres (Drizzle) implementation.
 *
 * A subscription is keyed by its push-service `endpoint`, which is globally unique. An
 * upsert therefore updates the existing row and (re)assigns it to the calling user, so a
 * browser that signs in as another account on the same device moves rather than
 * duplicates. Each user is capped at `MAX_SUBSCRIPTIONS_PER_USER` endpoints; the oldest
 * rows beyond the cap are evicted on insert.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { pushSubscriptions } from '@/db/schema'

import type { PushSubscriptionRepository } from './types'

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
