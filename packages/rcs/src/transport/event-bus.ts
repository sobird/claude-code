/**
 * In-process session event bus.
 *
 * This is a publish/subscribe fan-out only: the bus keeps no history and performs no
 * durable replay. Persistence is the caller's job via `repos.events.append`; Task 11
 * extends this module with the WebSocket/SSE transport that consumes it.
 */

import type { Repositories } from '../db/repositories/types.js'

export interface SessionEvent {
  /** Event UUID (`session_events.event_id`). */
  id: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  /** Durable bigserial id (`session_events.id`), used as the SSE sequence cursor. */
  seqNum: number
  /** Epoch milliseconds. */
  createdAt: number
}

export type SessionEventSubscriber = (event: SessionEvent) => void

export class EventBus {
  private readonly subscribers = new Set<SessionEventSubscriber>()
  private closed = false

  subscribe(callback: SessionEventSubscriber): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  subscriberCount(): number {
    return this.subscribers.size
  }

  publish(event: SessionEvent): SessionEvent {
    if (this.closed) throw new Error('EventBus is closed')
    for (const callback of this.subscribers) {
      try {
        callback(event)
      } catch {
        // A failing subscriber must not break the publisher; drop the error.
      }
    }
    return event
  }

  close(): void {
    this.closed = true
    this.subscribers.clear()
  }
}

const buses = new Map<string, EventBus>()

export function getEventBus(sessionId: string): EventBus {
  let bus = buses.get(sessionId)
  if (!bus) {
    bus = new EventBus()
    buses.set(sessionId, bus)
  }
  return bus
}

export function removeEventBus(sessionId: string): void {
  const bus = buses.get(sessionId)
  if (bus) {
    bus.close()
    buses.delete(sessionId)
  }
}

export function getAllEventBuses(): Map<string, EventBus> {
  return buses
}

/**
 * Extract plain text from the various message payload shapes the bridge emits:
 * `{ content: "text" }`, `{ message: { content: "text" } }`, and
 * `{ message: { content: [{ type: 'text', text: '…' }] } }`.
 */
function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return typeof payload === 'string' ? payload : ''
  }

  const p = payload as Record<string, unknown>

  if (typeof p.content === 'string' && p.content) return p.content

  const msg = p.message
  if (msg && typeof msg === 'object') {
    const content = (msg as Record<string, unknown>).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(
          (block: unknown) =>
            typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text',
        )
        .map((block: Record<string, unknown>) => (typeof block.text === 'string' ? block.text : ''))
        .join('')
    }
  }

  return ''
}

/**
 * Normalize an event payload into a flat structure with a guaranteed `content`
 * string. The original payload is preserved in `raw`; tool- and permission-specific
 * fields are copied through.
 */
export function normalizePayload(type: string, payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return { content: typeof payload === 'string' ? payload : '', raw: payload }
  }

  const p = payload as Record<string, unknown>
  const normalized: Record<string, unknown> = {
    content: extractContent(payload),
    raw: payload,
  }

  if (typeof p.uuid === 'string' && p.uuid) normalized.uuid = p.uuid
  if (typeof p.isSynthetic === 'boolean') normalized.isSynthetic = p.isSynthetic
  if (typeof p.status === 'string') normalized.status = p.status
  if (typeof p.subtype === 'string') normalized.subtype = p.subtype

  if (p.tool_name) normalized.tool_name = p.tool_name
  if (p.name) normalized.tool_name = p.name
  if (p.tool_input) normalized.tool_input = p.tool_input
  if (p.input) normalized.tool_input = p.input

  if (p.request_id) normalized.request_id = p.request_id
  if (p.request) normalized.request = p.request
  if (p.approved !== undefined) normalized.approved = p.approved
  if (p.updated_input) normalized.updated_input = p.updated_input

  if (p.message) normalized.message = p.message

  if (type === 'task_state') {
    if (typeof p.task_list_id === 'string') normalized.task_list_id = p.task_list_id
    if (typeof p.taskListId === 'string') normalized.taskListId = p.taskListId
    if (Array.isArray(p.tasks)) normalized.tasks = p.tasks
  }

  return normalized
}

/**
 * Persist a session event (write-through to `session_events`) and publish it to the
 * supplied bus. Returns the published event; its `seqNum` is the durable row id.
 */
export async function publishSessionEvent(
  repos: Repositories,
  eventBus: EventBus | null,
  sessionId: string,
  type: string,
  payload: unknown,
  direction: 'inbound' | 'outbound',
): Promise<SessionEvent> {
  const normalized = normalizePayload(type, payload)
  const record = await repos.events.append({ sessionId, type, payload: normalized, direction })
  const event: SessionEvent = {
    id: record.eventId,
    sessionId,
    type,
    payload: normalized,
    direction,
    seqNum: record.id,
    createdAt: record.createdAt.getTime(),
  }
  eventBus?.publish(event)
  return event
}
