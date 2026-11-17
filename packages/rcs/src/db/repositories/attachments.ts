/**
 * Image attachment repository: raw bytes live in Postgres (`bytea`), keyed by an
 * `att_…` id and deduped per owner on `sha256`.
 */

import { and, eq } from 'drizzle-orm'

import type { AttachmentRecord } from '../../contracts'
import type { Database } from '../client'
import { attachments } from '../schema'
import type { AttachmentRepository, CreateAttachmentInput } from './types'

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

function clone(record: AttachmentRecord): AttachmentRecord {
  return { ...record, data: new Uint8Array(record.data), createdAt: new Date(record.createdAt) }
}

export function createMemoryAttachmentRepository(): AttachmentRepository {
  const byId = new Map<string, AttachmentRecord>()

  return {
    async createOrGet(input: CreateAttachmentInput) {
      for (const record of byId.values()) {
        if (record.ownerUserId === input.ownerUserId && record.sha256 === input.sha256) return clone(record)
      }
      const record: AttachmentRecord = {
        id: `att_${crypto.randomUUID()}`,
        ...input,
        data: new Uint8Array(input.data),
        createdAt: new Date(),
      }
      byId.set(record.id, record)
      return clone(record)
    },

    async getById(id) {
      const record = byId.get(id)
      return record ? clone(record) : null
    },
  }
}
