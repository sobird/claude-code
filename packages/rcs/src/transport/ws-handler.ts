/**
 * Bridge WebSocket transport.
 *
 * On open the socket replays durable outbound events (work the bridge has not processed
 * yet) and then receives live outbound events only. Inbound history is deliberately never
 * replayed: the bridge deduplicates replayed *user* messages against its local transcript,
 * but injects every replayed *assistant* message into the live conversation, so re-sending
 * the child's own turns duplicates `tool_use` blocks whose `tool_result` partners were
 * skipped (the model API rejects the request with a 400). Inbound bridge messages are
 * persisted *before* they are published (write-through), and a keepalive frame keeps
 * proxies from dropping an idle socket.
 *
 * Bun-specific behaviour lives in `ws-shared.ts`; this module only uses the runtime-neutral
 * `hono/ws` `WSContext` type.
 */

import type { WSContext } from 'hono/ws'

import type { GatewayConfig } from '@/config'
import type { Repositories } from '@/db/repositories/types'
import { sanitizeTaskUsage } from '@/lib/background-tasks'

import { clearBridgeResponses, settleBridgeResponse } from './bridge-requests.js'
import { createAttachmentLoader, hasAttachmentRefs, hydrateClientPayload, toClientPayload } from './client-payload.js'
import type { SessionEvent } from './event-bus.js'
import { getEventBus, loadEventReplayWindow, publishInboundEvent, subscribeReplayThenLive } from './event-bus.js'
import { clearModelCatalog } from './model-catalog.js'

// Per-connection cleanup, keyed by sessionId (only one WS per session).
interface CleanupEntry {
  unsub: () => void
  keepalive: ReturnType<typeof setInterval> | null
  ws: WSContext
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

/**
 * Event types that must not be replayed to the bridge. A durable `interrupt`
 * would abort the session on every reconnect; replayed control requests and
 * responses feed stale decisions back to the child, which echoes them, growing
 * the replay window each time.
 */
const NON_REPLAYABLE_EVENT_TYPES = new Set(['interrupt', 'control_request', 'control_response', 'permission_response'])

/** NDJSON: every message must end with `\n` for the child process's line parser. */
function sendPayload(ws: WSContext, payload: Record<string, unknown>): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(payload) + '\n')
  } catch (error) {
    console.error('[ws] send error:', error)
  }
}

/**
 * Write a frame straight to the session's live bridge socket, bypassing persistence and
 * replay. Used for throwaway control traffic such as `@` file completion, whose request
 * and response must not grow `session_events`. Returns false when no bridge is connected.
 */
export function sendToBridge(sessionId: string, payload: Record<string, unknown>): boolean {
  const entry = cleanupBySession.get(sessionId)
  if (!entry || entry.ws.readyState !== 1) return false
  sendPayload(entry.ws, payload)
  return true
}

/** True while the session's CLI bridge socket is open; the archive guard uses it as a liveness signal. */
export function hasBridgeConnection(sessionId: string): boolean {
  return cleanupBySession.get(sessionId)?.ws.readyState === 1
}

/**
 * Called from `onOpen`: subscribe before reading durable history so no event can slip
 * across the replay→live boundary, then replay the newest `config.eventReplayLimit`
 * outbound events (there is no cursor on this path) and forward live outbound events.
 *
 * Only *outbound* events are replayed. Replaying inbound assistant history to a
 * reconnecting child duplicates its conversation: the child dedupes replayed user messages
 * against its local transcript and acks them, but re-injects every replayed assistant
 * message, so a duplicated `tool_use` is left without its (skipped) `tool_result` and the
 * next API request fails with a 400.
 */
export async function handleWebSocketOpen(
  repos: Repositories,
  config: GatewayConfig,
  ws: WSContext,
  sessionId: string,
): Promise<void> {
  activeConnections.add(ws)

  const existing = cleanupBySession.get(sessionId)
  if (existing) {
    existing.unsub()
    stopKeepalive(existing)
    activeConnections.delete(existing.ws)
    // Direct requests written to the old socket are not replayed; fail them now.
    clearBridgeResponses(sessionId)
    // The replacement child answers its own `initialize`; drop the stale catalog.
    clearModelCatalog(sessionId)
  }

  const keepaliveIntervalMs =
    Math.max(config.wsKeepaliveInterval || 0, 0) > 0
      ? config.wsKeepaliveInterval * 1000
      : DEFAULT_KEEPALIVE_INTERVAL_SECONDS * 1000

  const entry: CleanupEntry = { unsub: () => {}, keepalive: null, ws }
  // The bridge's hybrid transport writes over HTTP POST, so inbound WS data frames never
  // arrive; only this keepalive frame (for proxy idle timers) is sent. Dead sockets are
  // reaped by Bun's `idleTimeout`, which counts the client's periodic protocol pings —
  // closing on data-frame silence here would kill healthy read-only connections.
  entry.keepalive = setInterval(() => {
    if (ws.readyState !== 1) {
      stopKeepalive(entry)
      return
    }
    try {
      ws.send('{"type":"keep_alive"}\n')
    } catch {
      stopKeepalive(entry)
    }
  }, keepaliveIntervalMs)

  const load = createAttachmentLoader(repos)
  // Attachment hydration is async, so hydrated sends go through a promise chain to
  // stay in seqNum order. The common (text-only) path still sends synchronously
  // unless a hydration is already in flight ahead of it.
  let sendChain = Promise.resolve()
  let pendingHydrations = 0
  const enqueue = (event: SessionEvent) => {
    const payload = toClientPayload(event)
    if (pendingHydrations === 0 && !hasAttachmentRefs(payload)) {
      sendPayload(ws, payload)
      return
    }
    pendingHydrations++
    sendChain = sendChain
      .then(async () => {
        if (ws.readyState === 1) sendPayload(ws, await hydrateClientPayload(payload, load))
      })
      .catch((error) => console.error('[ws] send error:', error))
      .finally(() => {
        pendingHydrations--
      })
  }

  const subscription = subscribeReplayThenLive({
    bus: getEventBus(sessionId),
    fromSeqNum: 0,
    replay: true,
    // Only outbound events are replayed, and the direction filter runs inside the query so
    // an inbound backlog cannot consume the replay window.
    loadSince: async () =>
      (await loadEventReplayWindow(repos, sessionId, 0, config.eventReplayLimit, 'outbound')).filter(
        (event) => !NON_REPLAYABLE_EVENT_TYPES.has(event.type),
      ),
    filterLiveEvent: (event) => event.direction === 'outbound',
    onReplayEvent: enqueue,
    onLiveEvent: enqueue,
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
    clearBridgeResponses(sessionId)
    clearModelCatalog(sessionId)
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

/** System subtypes that describe a background task's lifecycle. */
const TASK_SUBTYPES = new Set(['task_started', 'task_progress', 'task_notification'])
const TASK_FIELD_KEYS = [
  'task_id',
  'tool_use_id',
  'description',
  'task_type',
  'status',
  'summary',
  'last_tool_name',
] as const

/**
 * Whitelist the fields the web background-task panel reads. `output_file` is a
 * path on the CLI host, and `prompt` can hold conversation content, so neither
 * is forwarded. Usage counters are sanitized to three finite numbers.
 */
function taskFieldsOf(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of TASK_FIELD_KEYS) {
    if (typeof msg[key] === 'string') out[key] = msg[key]
  }
  // Re-emit the sanitized counters in the SDK's snake_case shape: `normalizePayload`
  // lifts them again on the way to the durable event, so strip everything else here.
  const usage = sanitizeTaskUsage(msg.usage)
  if (usage) {
    out.usage = { total_tokens: usage.totalTokens, tool_uses: usage.toolUses, duration_ms: usage.durationMs }
  }
  return out
}

/** Parse one SDK message from the bridge → persist and publish it as an inbound event. */
export async function ingestBridgeMessage(
  repos: Repositories,
  sessionId: string,
  msg: Record<string, unknown>,
): Promise<SessionEvent | null> {
  if (msg.type === 'keep_alive') return null

  // The child acks replayed user messages with `isReplay: true`. An ack is not a
  // new event: persisting it adds a durable copy on every reconnect, the next
  // replay window carries that copy back, and the child acks it again — the loop
  // compounds until the model API rejects the duplicated tool_use blocks.
  if (msg.isReplay === true) return null

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
    payload = {
      message: msg.message,
      uuid: msg.uuid,
      content: text,
      // Subagent traffic is tagged with its Agent tool_use id; the web reducer
      // nests by that pointer, so it must survive this whitelist.
      ...(typeof msg.parent_tool_use_id === 'string' ? { parent_tool_use_id: msg.parent_tool_use_id } : {}),
    }
  } else if (eventType === 'user') {
    payload = {
      message: msg.message,
      uuid: msg.uuid,
      ...(typeof msg.isSynthetic === 'boolean' ? { isSynthetic: msg.isSynthetic } : {}),
      ...(typeof msg.parent_tool_use_id === 'string' ? { parent_tool_use_id: msg.parent_tool_use_id } : {}),
      // 结构化工具输出（HTTP 状态、字节数、搜索统计等）由 CLI 挂在 user 事件顶层，
      // 卡片头部要读它，所以必须在白名单里放行；其余字段不进浏览器。
      ...(msg.tool_use_result !== undefined ? { tool_use_result: msg.tool_use_result } : {}),
    }
  } else if (eventType === 'system') {
    // `system/init` carries the flat fields the web UI needs (slash commands,
    // permission mode). Whitelist them so tool/MCP inventories never reach the
    // browser, matching the CLI's own bridge-safe message shape.
    payload = {
      ...(typeof msg.subtype === 'string' ? { subtype: msg.subtype } : {}),
      ...(Array.isArray(msg.slash_commands) ? { slash_commands: msg.slash_commands } : {}),
      ...(typeof msg.permissionMode === 'string' ? { permissionMode: msg.permissionMode } : {}),
      ...(typeof msg.model === 'string' ? { model: msg.model } : {}),
      ...(typeof msg.fast_mode_state === 'string' ? { fast_mode_state: msg.fast_mode_state } : {}),
      // Detailed-transcript fields: compaction notices, API errors, permission
      // retries, and saved-memory paths. Metadata objects stay out.
      ...(typeof msg.content === 'string' ? { content: msg.content } : {}),
      ...(typeof msg.level === 'string' ? { level: msg.level } : {}),
      ...(Array.isArray(msg.commands) ? { commands: msg.commands.filter((item) => typeof item === 'string') } : {}),
      ...(Array.isArray(msg.writtenPaths)
        ? { writtenPaths: msg.writtenPaths.filter((item) => typeof item === 'string') }
        : {}),
      // Background-task lifecycle: only the three task subtypes carry these fields.
      ...(TASK_SUBTYPES.has(String(msg.subtype)) ? taskFieldsOf(msg) : {}),
      ...(msg.subtype === 'session_state_changed' && typeof msg.state === 'string' ? { state: msg.state } : {}),
      ...(msg.message ? { message: msg.message } : {}),
      uuid: msg.uuid,
    }
  } else if (eventType === 'control_request') {
    payload = { request_id: msg.request_id, request: msg.request }
  } else if (eventType === 'control_response') {
    // Responses to direct (unpersisted) requests are claimed by their waiter and must not
    // be stored or replayed; everything else follows the durable event path.
    const response = msg.response as Record<string, unknown> | undefined
    if (response && settleBridgeResponse(sessionId, response)) return null
    payload = { response: msg.response }
  } else if (eventType === 'result' || eventType === 'result_success') {
    payload = { subtype: msg.subtype, uuid: msg.uuid, result: msg.result }
  } else {
    payload = msg
  }

  // Await persistence before publishing: subscribers must never observe an unpersisted event.
  // Dedupes by message uuid: replayed assistant history is echoed back unmarked, and
  // persisting each echo grows the replay window on every reconnect.
  return publishInboundEvent(repos, getEventBus(sessionId), sessionId, eventType, payload)
}

/**
 * Close one session's bridge socket (the archive stop path). Mirrors `closeAllConnections`
 * for a single session and always drops pending control waiters and the cached model
 * catalog, so a session with no socket is still cleaned up.
 */
export function closeBridgeConnection(sessionId: string, code = 1001, reason = 'session_archived'): void {
  const entry = cleanupBySession.get(sessionId)
  if (entry) {
    try {
      entry.unsub()
      stopKeepalive(entry)
      if (entry.ws.readyState === 1) entry.ws.close(code, reason)
    } catch {
      // The socket may already be gone; the cleanup below still runs.
    }
    cleanupBySession.delete(sessionId)
    activeConnections.delete(entry.ws)
  }
  clearBridgeResponses(sessionId)
  clearModelCatalog(sessionId)
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
    clearBridgeResponses(sessionId)
    clearModelCatalog(sessionId)
  }
  activeConnections.clear()
}
