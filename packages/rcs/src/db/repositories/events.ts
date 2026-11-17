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

  // No `await` between id allocation and insertion, so ids stay unique.
  function insert(input: AppendEventInput): SessionEventRecord {
    const record: SessionEventRecord = {
      id: nextId++,
      eventId: crypto.randomUUID(),
      sessionId: input.sessionId,
      type: input.type,
      payload: input.payload,
      direction: input.direction,
      messageUuid: input.messageUuid ?? null,
      createdAt: new Date(),
    }
    eventsFor(input.sessionId).push(record)
    return cloneEvent(record)
  }

  return {
    async append(input) {
      return insert(input)
    },

    async appendIfAbsent(input) {
      if (input.direction === 'inbound' && input.messageUuid) {
        // No `await` between this check and the insert, mirroring the Postgres unique key.
        const duplicate = eventsFor(input.sessionId).some(
          (record) => record.direction === 'inbound' && record.messageUuid === input.messageUuid,
        )
        if (duplicate) return null
      }
      return insert(input)
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

    async latestCreatedAt(sessionId) {
      const records = bySessionId.get(sessionId)
      if (!records || records.length === 0) return null
      const newest = records.reduce((latest, record) => (record.id > latest.id ? record : latest))
      return new Date(newest.createdAt)
    },

    async hasMessageUuid(sessionId, uuid) {
      return (bySessionId.get(sessionId) ?? []).some((record) => record.messageUuid === uuid)
    },
  }
}
