/**
 * In-process session event bus.
 *
 * This is a publish/subscribe fan-out only: the bus keeps no history and performs no
 * durable replay. Persistence is the caller's job via `repos.events.append`; Task 11
 * extends this module with the WebSocket/SSE transport that consumes it.
 */

import type { SessionEventRecord } from '../contracts.js'
import type { Repositories } from '../db/repositories/types.js'

export interface SessionEvent {
  /** Event UUID (`session_events.event_id`). */
  id: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  /**
   * Sequence number. Durable events use the `session_events.id` bigserial (the SSE
   * cursor); live-only events use a reserved in-memory range and never advance it.
   */
  seqNum: number
  /** Epoch milliseconds. */
  createdAt: number
  /**
   * Live-only event (streaming deltas): delivered to connected subscribers, never
   * persisted and never replayed. Its frame carries no SSE `id:`, so it is never a
   * `Last-Event-ID` cursor.
   */
  ephemeral?: boolean
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
 * History-retaining event bus for ACP channel groups (R25).
 *
 * Unlike the session `EventBus` (fan-out only; durability lives in `session_events`), ACP
 * channel-group traffic stays in memory: the pre-rewrite bus kept the tail so a
 * reconnecting SSE consumer could replay recent events via `Last-Event-ID`. Port that
 * behaviour verbatim: at most `MAX_ACP_EVENTS_PER_BUS` events, evicting the oldest half.
 */
const MAX_ACP_EVENTS_PER_BUS = 5000

export class AcpEventBus {
  private readonly subscribers = new Set<SessionEventSubscriber>()
  private events: SessionEvent[] = []
  private seqNum = 0
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

  publish(event: Omit<SessionEvent, 'seqNum' | 'createdAt'>): SessionEvent {
    if (this.closed) throw new Error('AcpEventBus is closed')
    const full: SessionEvent = { ...event, seqNum: ++this.seqNum, createdAt: Date.now() }
    this.events.push(full)
    if (this.events.length > MAX_ACP_EVENTS_PER_BUS) {
      this.events = this.events.slice(-Math.floor(MAX_ACP_EVENTS_PER_BUS / 2))
    }
    for (const callback of this.subscribers) {
      try {
        callback(full)
      } catch {
        // A failing subscriber must not break the publisher; drop the error.
      }
    }
    return full
  }

  getLastSeqNum(): number {
    return this.seqNum
  }

  /** Retained events with `seqNum > seqNum`, oldest first. */
  getEventsSince(seqNum: number): SessionEvent[] {
    const index = this.events.findIndex((event) => event.seqNum > seqNum)
    return index === -1 ? [] : this.events.slice(index)
  }

  close(): void {
    this.closed = true
    this.subscribers.clear()
    this.events = []
  }
}

const acpBuses = new Map<string, AcpEventBus>()

/**
 * Namespaced key for an ACP channel-group bus. `channel_group_id` is client-supplied and
 * only meaningful within one owner's environments, so the bus is keyed by owner too —
 * otherwise two owners that pick the same id would share one event bus.
 */
export function acpBusKey(ownerUserId: string, channelGroupId: string): string {
  return `${ownerUserId}:${channelGroupId}`
}

export function getAcpEventBus(channelGroupId: string): AcpEventBus {
  let bus = acpBuses.get(channelGroupId)
  if (!bus) {
    bus = new AcpEventBus()
    acpBuses.set(channelGroupId, bus)
  }
  return bus
}

export function removeAcpEventBus(channelGroupId: string): void {
  const bus = acpBuses.get(channelGroupId)
  if (bus) {
    bus.close()
    acpBuses.delete(channelGroupId)
  }
}

/** Test/shutdown helper: all live ACP channel-group buses. */
export function getAllAcpEventBuses(): Map<string, AcpEventBus> {
  return acpBuses
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
 * Event types whose `uuid` identifies a whole message, so a repeated uuid is a replay of
 * a message that is already durable. Streaming deltas (`stream_event`, `partial_assistant`)
 * share the eventual message uuid but are distinct events and must never be deduplicated.
 */
const UUID_IDENTIFIED_EVENT_TYPES = new Set(['user', 'assistant', 'system', 'result', 'result_success'])

/** Extract the dedupe key for `type` from an already-normalized payload. */
function messageUuidOf(type: string, normalizedPayload: unknown): string | null {
  if (!UUID_IDENTIFIED_EVENT_TYPES.has(type)) return null
  if (!normalizedPayload || typeof normalizedPayload !== 'object') return null
  const uuid = (normalizedPayload as Record<string, unknown>).uuid
  return typeof uuid === 'string' && uuid ? uuid : null
}

async function appendAndPublish(
  repos: Repositories,
  eventBus: EventBus | null,
  sessionId: string,
  type: string,
  normalized: Record<string, unknown>,
  direction: 'inbound' | 'outbound',
  messageUuid: string | null,
): Promise<SessionEvent> {
  const record = await repos.events.append({ sessionId, type, payload: normalized, direction, messageUuid })
  const event = toSessionEvent(record)
  eventBus?.publish(event)
  return event
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
  return appendAndPublish(repos, eventBus, sessionId, type, normalized, direction, messageUuidOf(type, normalized))
}

/**
 * Event types that are inherently live-only: the bridge re-emits a full-so-far snapshot
 * roughly every 100ms while a message streams. No consumer replays them (the web reducer
 * ignores them; the bridge and worker streams replay outbound only), so persisting them
 * only grows `session_events` and doubles the payload under `raw`.
 */
const EPHEMERAL_EVENT_TYPES = new Set(['stream_event', 'partial_assistant'])

/**
 * Ephemeral events have no durable row, but SSE consumers still need a unique numeric
 * `seqNum` for per-connection dedupe. Allocate from a reserved high range that durable
 * bigserial ids will not reach in practice; the frame omits `id:`, so this value never
 * becomes a resume cursor.
 */
const EPHEMERAL_SEQ_BASE = Number.MAX_SAFE_INTEGER - 2 ** 32
let ephemeralSeqNum = EPHEMERAL_SEQ_BASE

export interface PublishInboundOptions {
  /** The client marks stream snapshots `ephemeral: true`; publish live without persisting. */
  ephemeral?: boolean
}

function publishEphemeralEvent(
  eventBus: EventBus | null,
  sessionId: string,
  type: string,
  normalized: Record<string, unknown>,
): SessionEvent {
  const event: SessionEvent = {
    id: crypto.randomUUID(),
    sessionId,
    type,
    payload: normalized,
    direction: 'inbound',
    seqNum: ++ephemeralSeqNum,
    createdAt: Date.now(),
    ephemeral: true,
  }
  eventBus?.publish(event)
  return event
}

/**
 * Persist an inbound bridge event unless a whole-message event with the same uuid is
 * already durable for the session, and publish it.
 *
 * The bridge replays its history to the child on every reconnect; the child injects and
 * echoes those messages back, and acks duplicate user prompts with `isReplay: true`.
 * Persisting every echo makes the next replay window larger, so the loop compounds until
 * the model API rejects duplicated `tool_use` blocks. The transport contract is explicit
 * that the server deduplicates bridge writes by UUID (WebSocketTransport's reconnect
 * replay), so this is the server's responsibility.
 *
 * Ephemeral events (explicit flag or a streaming-delta type) skip persistence entirely
 * and are delivered live only.
 *
 * Returns `null` when the event was dropped as a duplicate.
 */
export async function publishInboundEvent(
  repos: Repositories,
  eventBus: EventBus | null,
  sessionId: string,
  type: string,
  payload: unknown,
  options?: PublishInboundOptions,
): Promise<SessionEvent | null> {
  const normalized = normalizePayload(type, payload)
  if (options?.ephemeral === true || EPHEMERAL_EVENT_TYPES.has(type)) {
    return publishEphemeralEvent(eventBus, sessionId, type, normalized)
  }
  const messageUuid = messageUuidOf(type, normalized)
  // Cheap early exit for the common sequential replay; the read is not authoritative.
  if (messageUuid && (await repos.events.hasMessageUuid(sessionId, messageUuid))) return null
  // The durable key is the real guard: two concurrent writers can both pass the check above.
  const record = await repos.events.appendIfAbsent({
    sessionId,
    type,
    payload: normalized,
    direction: 'inbound',
    messageUuid,
  })
  if (!record) return null
  const event = toSessionEvent(record)
  eventBus?.publish(event)
  return event
}

/** Map a persisted `session_events` row onto the in-process event shape. */
export function toSessionEvent(record: SessionEventRecord): SessionEvent {
  return {
    id: record.eventId,
    sessionId: record.sessionId,
    type: record.type,
    payload: record.payload,
    direction: record.direction,
    seqNum: record.id,
    createdAt: record.createdAt.getTime(),
  }
}

/**
 * Load one durable replay window in ascending `seqNum` order.
 *
 * A real cursor replays the *oldest* events after it (bounded by `limit`). Without a
 * cursor there is nothing to resume from, so replay the *newest* `limit` events: the
 * pre-rewrite in-memory bus retained the tail (evicting oldest), and replaying from 0
 * would silently drop the most recent pre-connect history of a long session. Events
 * appended after `latestId` resolves are delivered live by the caller's subscription.
 */
export async function loadEventReplayWindow(
  repos: Repositories,
  sessionId: string,
  cursor: number,
  limit: number,
): Promise<SessionEvent[]> {
  if (cursor > 0) {
    return (await repos.events.listSince(sessionId, cursor, limit)).map(toSessionEvent)
  }

  const latest = await repos.events.latestId(sessionId)
  if (latest === null) return []
  return (await repos.events.listBefore(sessionId, latest + 1, limit)).map(toSessionEvent)
}

export interface ReplayThenLiveOptions {
  bus: EventBus
  /** Cursor: replay events with `seqNum > fromSeqNum`. */
  fromSeqNum: number
  /**
   * Load the durable replay window. Called once, after the live subscription is active.
   * Ignored unless `replay` is true.
   */
  loadSince: () => Promise<SessionEvent[]>
  /** Emit replayed events, in ascending `seqNum` order. */
  onReplayEvent: (event: SessionEvent) => void
  /** Emit live events, including any buffered during the replay query. */
  onLiveEvent: (event: SessionEvent) => void
  /** Force replay even when `fromSeqNum` is 0; the WebSocket and SSE paths both set it. */
  replay?: boolean
  /** Live-only filter; replayed events are filtered by `loadSince`. */
  filterLiveEvent?: (event: SessionEvent) => boolean
  /** True once the consumer is gone; emission stops and the subscription is dropped. */
  isClosed?: () => boolean
}

export interface ReplayThenLiveSubscription {
  /** Resolves once the replay has been emitted and buffered live events have been flushed. */
  ready: Promise<void>
  /** Detach the live subscription and drop any buffered events. */
  unsubscribe: () => void
}

/**
 * Subscribe to a session bus before reading durable history, then emit the replay followed
 * by live events.
 *
 * This closes the persist-then-publish race (R22): an event appended between "read history"
 * and "subscribe" would otherwise be lost, and an event appended before the history read
 * but published during it would otherwise be duplicated. Live events received while the
 * replay query is in flight are buffered; after the replay they are flushed only when their
 * `seqNum` exceeds the last replayed `seqNum`, which dedupes the replay/live boundary
 * without losing anything.
 */
export function subscribeReplayThenLive(options: ReplayThenLiveOptions): ReplayThenLiveSubscription {
  const { bus } = options
  const buffered: SessionEvent[] = []
  let replaying = true
  let stopped = false

  const unsubscribe = () => {
    if (stopped) return
    stopped = true
    buffered.length = 0
    detach()
  }

  const detach = bus.subscribe((event) => {
    if (stopped) return
    if (options.filterLiveEvent && !options.filterLiveEvent(event)) return
    if (replaying) {
      buffered.push(event)
      return
    }
    try {
      options.onLiveEvent(event)
    } catch {
      unsubscribe()
    }
  })

  const ready = (async () => {
    let replayed: SessionEvent[] = []
    const shouldReplay = options.replay ?? options.fromSeqNum > 0
    if (shouldReplay) {
      try {
        replayed = await options.loadSince()
      } catch {
        replayed = []
      }
    }

    if (stopped || options.isClosed?.()) {
      unsubscribe()
      return
    }

    let lastReplayedSeqNum = options.fromSeqNum
    for (const event of replayed) {
      if (stopped || options.isClosed?.()) {
        unsubscribe()
        return
      }
      try {
        options.onReplayEvent(event)
      } catch {
        unsubscribe()
        return
      }
      if (event.seqNum > lastReplayedSeqNum) lastReplayedSeqNum = event.seqNum
    }

    replaying = false
    for (const event of buffered) {
      if (stopped || options.isClosed?.()) {
        unsubscribe()
        return
      }
      // Dedupe the replay/live boundary: anything already covered by the replay is dropped.
      if (event.seqNum <= lastReplayedSeqNum) continue
      try {
        options.onLiveEvent(event)
      } catch {
        unsubscribe()
        return
      }
    }
    buffered.length = 0
  })()

  return { ready, unsubscribe }
}
