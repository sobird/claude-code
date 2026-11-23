/**
 * Durable session-event repository: Postgres (Drizzle) implementation.
 *
 * Events carry a globally monotonic `bigserial` id that doubles as the SSE
 * `Last-Event-ID` / seqNum cursor. `listSince` is exclusive (`id > afterId`) so a client
 * replaying from the last event it saw never sees a duplicate; `listBefore` returns the
 * newest window, reversed into ascending display order.
 */

import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { sessionEvents } from '@/db/schema'

import type { AppendEventInput, EventRepository } from './types'

function insertValues(input: AppendEventInput) {
  return {
    eventId: crypto.randomUUID(),
    sessionId: input.sessionId,
    type: input.type,
    payload: input.payload,
    direction: input.direction,
    messageUuid: input.messageUuid ?? null,
    createdAt: new Date(),
  }
}

export function createEventRepository(db: Database): EventRepository {
  return {
    async append(input) {
      const [row] = await db.insert(sessionEvents).values(insertValues(input)).returning()
      return row
    },

    async appendIfAbsent(input) {
      // The partial unique index (`inbound` + non-null `message_uuid`) is the arbiter;
      // `DO NOTHING` without a target also covers it. A conflict yields no returned row.
      const [row] = await db.insert(sessionEvents).values(insertValues(input)).onConflictDoNothing().returning()
      return row ?? null
    },

    async listSince(sessionId, afterId, limit, direction) {
      const filters = [eq(sessionEvents.sessionId, sessionId), gt(sessionEvents.id, afterId)]
      if (direction) filters.push(eq(sessionEvents.direction, direction))
      return db
        .select()
        .from(sessionEvents)
        .where(and(...filters))
        .orderBy(asc(sessionEvents.id))
        .limit(limit)
    },

    async listBefore(sessionId, beforeId, limit, direction) {
      const filters = [eq(sessionEvents.sessionId, sessionId), lt(sessionEvents.id, beforeId)]
      if (direction) filters.push(eq(sessionEvents.direction, direction))
      const rows = await db
        .select()
        .from(sessionEvents)
        .where(and(...filters))
        .orderBy(desc(sessionEvents.id))
        .limit(limit)
      return rows.toReversed()
    },

    async latestId(sessionId) {
      const [row] = await db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.id))
        .limit(1)
      return row?.id ?? null
    },

    async latestCreatedAt(sessionId) {
      const [row] = await db
        .select({ createdAt: sessionEvents.createdAt })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.id))
        .limit(1)
      return row?.createdAt ?? null
    },

    async hasMessageUuid(sessionId, uuid) {
      const [row] = await db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.messageUuid, uuid)))
        .limit(1)
      return row !== undefined
    },
  }
}
