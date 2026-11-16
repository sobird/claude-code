/**
 * Bridge WebSocket transport.
 *
 * On open the socket replays durable history from `session_events` (all directions, so the
 * bridge can rebuild the conversation) and then receives live outbound events only. Inbound
 * bridge messages are persisted *before* they are published (write-through), and dead
 * clients are detected by a keepalive frame plus an inactivity deadline.
 *
 * Bun-specific behaviour lives in `ws-shared.ts`; this module only uses the runtime-neutral
 * `hono/ws` `WSContext` type.
 */

import type { WSContext } from 'hono/ws'

import type { GatewayConfig } from '../config.js'
import type { Repositories } from '../db/repositories/types.js'
import { toClientPayload } from './client-payload.js'
import type { SessionEvent } from './event-bus.js'
import { getEventBus, publishSessionEvent, subscribeReplayThenLive, toSessionEvent } from './event-bus.js'

// Per-connection cleanup, keyed by sessionId (only one WS per session).
interface CleanupEntry {
  unsub: () => void
  keepalive: ReturnType<typeof setInterval> | null
  ws: WSContext
  openTime: number
  lastClientActivity: number
}

function stopKeepalive(entry: CleanupEntry): void {
  if (entry.keepalive) {
    clearInterval(entry.keepalive)
    entry.keepalive = null
  }
}

const cleanupBySession = new Map<string, CleanupEntry>()

// Track all active WS connections for graceful shutdown.
const activeConnections = new Set<WSContext>()

// Serializes ingestion per session. Bun does not await async message handlers, so frames
// can arrive faster than they are persisted; a promise chain keeps durable `seqNum` order
// identical to arrival order.
const ingestQueues = new Map<string, Promise<void>>()

const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 20

/** NDJSON: every message must end with `\n` for the child process's line parser. */
function toSDKMessage(event: SessionEvent): string {
  return JSON.stringify(toClientPayload(event)) + '\n'
}

function sendEvent(ws: WSContext, event: SessionEvent): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(toSDKMessage(event))
  } catch (error) {
    console.error('[ws] send error:', error)
  }
}

/**
 * Called from `onOpen`: subscribe before reading durable history so no event can slip
 * across the replay→live boundary, then replay from the beginning (bounded by
 * `config.eventReplayLimit`) and forward live outbound events.
 */
export async function handleWebSocketOpen(
  repos: Repositories,
  config: GatewayConfig,
  ws: WSContext,
  sessionId: string,
): Promise<void> {
  const openTime = Date.now()
  activeConnections.add(ws)

  const existing = cleanupBySession.get(sessionId)
  if (existing) {
    existing.unsub()
    stopKeepalive(existing)
    activeConnections.delete(existing.ws)
  }

  const keepaliveIntervalMs =
    Math.max(config.wsKeepaliveInterval || 0, 0) > 0
      ? config.wsKeepaliveInterval * 1000
      : DEFAULT_KEEPALIVE_INTERVAL_SECONDS * 1000
  // Three missed keepalives mark the client dead.
  const clientActivityTimeoutMs = keepaliveIntervalMs * 3

  const entry: CleanupEntry = { unsub: () => {}, keepalive: null, ws, openTime, lastClientActivity: Date.now() }
  entry.keepalive = setInterval(() => {
    if (ws.readyState !== 1) {
      stopKeepalive(entry)
      return
    }
    const silenceMs = Date.now() - entry.lastClientActivity
    if (silenceMs > clientActivityTimeoutMs) {
      try {
        ws.close(1000, 'client inactive')
      } catch {
        stopKeepalive(entry)
      }
      return
    }
    try {
      ws.send('{"type":"keep_alive"}\n')
    } catch {
      stopKeepalive(entry)
    }
  }, keepaliveIntervalMs)

  const subscription = subscribeReplayThenLive({
    bus: getEventBus(sessionId),
    fromSeqNum: 0,
    replay: true,
    loadSince: async () => (await repos.events.listSince(sessionId, 0, config.eventReplayLimit)).map(toSessionEvent),
    filterLiveEvent: (event) => event.direction === 'outbound',
    onReplayEvent: (event) => sendEvent(ws, event),
    onLiveEvent: (event) => sendEvent(ws, event),
    isClosed: () => ws.readyState !== 1,
  })

  entry.unsub = subscription.unsubscribe
  cleanupBySession.set(sessionId, entry)

  await subscription.ready

  if (ws.readyState !== 1) {
    stopKeepalive(entry)
    subscription.unsubscribe()
    activeConnections.delete(ws)
    if (cleanupBySession.get(sessionId) === entry) cleanupBySession.delete(sessionId)
  }
}

/**
 * Called from `onMessage`: the bridge sends newline-delimited JSON. Messages are persisted
 * sequentially so their durable `seqNum` order matches arrival order.
 */
export function handleWebSocketMessage(
  repos: Repositories,
  ws: WSContext,
  sessionId: string,
  data: string,
): Promise<void> {
  void ws
  const entry = cleanupBySession.get(sessionId)
  if (entry) {
    entry.lastClientActivity = Date.now()
  }

  const messages: Array<Record<string, unknown>> = []
  for (const line of data.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      console.error('[ws] parse error:', error)
      continue
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      messages.push(parsed as Record<string, unknown>)
    }
  }

  const ingestAll = async (): Promise<void> => {
    for (const message of messages) {
      try {
        await ingestBridgeMessage(repos, sessionId, message)
      } catch (error) {
        console.error('[ws] ingest error:', error)
      }
    }
  }

  const previous = ingestQueues.get(sessionId) ?? Promise.resolve()
  const next = previous.then(ingestAll)
  ingestQueues.set(sessionId, next)
  void next.finally(() => {
    if (ingestQueues.get(sessionId) === next) ingestQueues.delete(sessionId)
  })
  return next
}

/** Called from `onClose`: unsubscribes and clears the keepalive timer. */
export function handleWebSocketClose(ws: WSContext, sessionId: string, code?: number, reason?: string): void {
  void code
  void reason
  activeConnections.delete(ws)

  const entry = cleanupBySession.get(sessionId)
  // A replaced connection's late close event must not tear down its successor.
  if (entry && entry.ws === ws) {
    entry.unsub()
    stopKeepalive(entry)
    cleanupBySession.delete(sessionId)
  }
}

/**
 * Derive the event type from a child-process message. `--print --output-format stream-json`
 * emits messages without a top-level `type`: `message.role` identifies user/assistant, a
 * `subtype`/`result` marks a result, and `session_id` marks a system/init message.
 */
function deriveEventType(msg: Record<string, unknown>): string {
  if (msg.type && typeof msg.type === 'string') return msg.type

  const message = msg.message as Record<string, unknown> | undefined
  if (message && typeof message.role === 'string') {
    return message.role
  }

  if (msg.subtype || msg.result !== undefined) return 'result'
  if (msg.session_id) return 'system'
  return 'unknown'
}

/** Parse one SDK message from the bridge → persist and publish it as an inbound event. */
export async function ingestBridgeMessage(
  repos: Repositories,
  sessionId: string,
  msg: Record<string, unknown>,
): Promise<SessionEvent | null> {
  if (msg.type === 'keep_alive') return null

  const eventType = deriveEventType(msg)

  let payload: unknown
  if (eventType === 'assistant' || eventType === 'partial_assistant') {
    const message = msg.message as Record<string, unknown> | undefined
    const content = message?.content
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .filter(
          (block: unknown) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text',
        )
        .map((block: Record<string, unknown>) => (typeof block.text === 'string' ? block.text : ''))
        .join('')
    }
    payload = { message: msg.message, uuid: msg.uuid, content: text }
  } else if (eventType === 'user' || eventType === 'system') {
    payload = {
      message: msg.message,
      uuid: msg.uuid,
      ...(typeof msg.isSynthetic === 'boolean' ? { isSynthetic: msg.isSynthetic } : {}),
    }
  } else if (eventType === 'control_request') {
    payload = { request_id: msg.request_id, request: msg.request }
  } else if (eventType === 'control_response') {
    payload = { response: msg.response }
  } else if (eventType === 'result' || eventType === 'result_success') {
    payload = { subtype: msg.subtype, uuid: msg.uuid, result: msg.result }
  } else {
    payload = msg
  }

  // Await persistence before publishing: subscribers must never observe an unpersisted event.
  return publishSessionEvent(repos, getEventBus(sessionId), sessionId, eventType, payload, 'inbound')
}

/** Gracefully close every active WebSocket connection (server shutdown). */
export function closeAllConnections(): void {
  if (activeConnections.size === 0) {
    cleanupBySession.clear()
    return
  }

  for (const [sessionId, entry] of cleanupBySession) {
    try {
      entry.unsub()
      stopKeepalive(entry)
      if (entry.ws.readyState === 1) {
        entry.ws.close(1001, 'server_shutdown')
      }
    } catch {
      // ignore errors during shutdown
    }
    cleanupBySession.delete(sessionId)
  }
  activeConnections.clear()
}
