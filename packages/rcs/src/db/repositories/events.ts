/**
 * Durable session-event repository: Postgres (Drizzle) and in-memory implementations.
 *
 * Events carry a globally monotonic `bigserial` id that doubles as the SSE
 * `Last-Event-ID` / seqNum cursor. `listSince` is exclusive (`id > afterId`) so a client
 * replaying from the last event it saw never sees a duplicate; `listBefore` returns the
 * newest window, reversed into ascending display order.
 */

import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'

import type { SessionEventRecord } from '../../contracts'
import type { Database } from '../client'
import { sessionEvents } from '../schema'
import type { EventRepository } from './types'

export function createEventRepository(db: Database): EventRepository {
  return {
    async append(input) {
      const [row] = await db
        .insert(sessionEvents)
        .values({
          eventId: crypto.randomUUID(),
          sessionId: input.sessionId,
          type: input.type,
          payload: input.payload,
          direction: input.direction,
          createdAt: new Date(),
        })
        .returning()
      return row
    },

    async listSince(sessionId, afterId, limit) {
      return db
        .select()
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, sessionId), gt(sessionEvents.id, afterId)))
        .orderBy(asc(sessionEvents.id))
        .limit(limit)
    },

    async listBefore(sessionId, beforeId, limit) {
      const rows = await db
        .select()
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, sessionId), lt(sessionEvents.id, beforeId)))
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
  }
}

function cloneEvent(record: SessionEventRecord): SessionEventRecord {
  return { ...record, createdAt: new Date(record.createdAt) }
}

export function createMemoryEventRepository(): EventRepository {
  const bySessionId = new Map<string, SessionEventRecord[]>()
  let nextId = 1

  function eventsFor(sessionId: string): SessionEventRecord[] {
    const existing = bySessionId.get(sessionId)
    if (existing) return existing
    const created: SessionEventRecord[] = []
    bySessionId.set(sessionId, created)
    return created
  }

  return {
    async append(input) {
      // No `await` between id allocation and insertion, so ids stay unique.
      const record: SessionEventRecord = {
        id: nextId++,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: input.type,
        payload: input.payload,
        direction: input.direction,
        createdAt: new Date(),
      }
      eventsFor(input.sessionId).push(record)
      return cloneEvent(record)
    },

    async listSince(sessionId, afterId, limit) {
      return (bySessionId.get(sessionId) ?? [])
        .filter((record) => record.id > afterId)
        .toSorted((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(cloneEvent)
    },

    async listBefore(sessionId, beforeId, limit) {
      return (bySessionId.get(sessionId) ?? [])
        .filter((record) => record.id < beforeId)
        .toSorted((a, b) => b.id - a.id)
        .slice(0, limit)
        .toReversed()
        .map(cloneEvent)
    },

    async latestId(sessionId) {
      const records = bySessionId.get(sessionId)
      if (!records || records.length === 0) return null
      return records.reduce((max, record) => Math.max(max, record.id), 0)
    },
  }
}
