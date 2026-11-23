/**
 * Image attachment repository: raw bytes live in Postgres (`bytea`), keyed by an
 * `att_…` id and deduped per owner on `sha256`.
 */

import { and, eq } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { attachments } from '@/db/schema'

import type { AttachmentRepository } from './types'

export function createAttachmentRepository(db: Database): AttachmentRepository {
  return {
    async createOrGet(input) {
      const [inserted] = await db
        .insert(attachments)
        .values({ id: `att_${crypto.randomUUID()}`, ...input })
        .onConflictDoNothing()
        .returning()
      if (inserted) return inserted
      // The unique `(owner_user_id, sha256)` index rejected the insert: return the winner.
      const [existing] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.ownerUserId, input.ownerUserId), eq(attachments.sha256, input.sha256)))
        .limit(1)
      if (!existing) throw new Error('Attachment conflict without an existing row')
      return existing
    },

    async getById(id) {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
      return row ?? null
    },
  }
}
