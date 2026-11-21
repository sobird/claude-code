/**
 * VAPID settings repository: Postgres (Drizzle) and in-memory implementations.
 *
 * There is a single settings row (`id = 'default'`); `set` upserts it so the VAPID key
 * pair can be rotated in place.
 */

import { eq } from 'drizzle-orm'

import type { PushVapidKeys } from '@/contracts'
import type { Database } from '@/db/client'
import { pushSettings } from '@/db/schema'

import type { PushSettingsRepository } from './types'

const SETTINGS_ID = 'default'

export function createPushSettingsRepository(db: Database): PushSettingsRepository {
  return {
    async get() {
      const [row] = await db.select().from(pushSettings).where(eq(pushSettings.id, SETTINGS_ID)).limit(1)
      if (!row) return null
      return { publicKey: row.publicKey, privateKey: row.privateKey, subject: row.subject }
    },

    async set(keys) {
      const now = new Date()
      await db
        .insert(pushSettings)
        .values({
          id: SETTINGS_ID,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: keys.subject,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: pushSettings.id,
          set: {
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
            subject: keys.subject,
            updatedAt: now,
          },
        })
    },
  }
}

export function createMemoryPushSettingsRepository(): PushSettingsRepository {
  let stored: PushVapidKeys | null = null

  return {
    async get() {
      return stored ? { ...stored } : null
    },

    async set(keys) {
      stored = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: keys.subject }
    },
  }
}
