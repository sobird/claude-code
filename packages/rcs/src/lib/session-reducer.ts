/**
 * Pure chat reducer for the session detail view.
 *
 * Folds durable history (`GET /web/sessions/:id/history`) and live SSE frames
 * (`useSessionStream`) into one `ThreadEntry[]` model. It is React-free so the
 * fold semantics can be unit tested, and it dedupes by durable `seqNum` because
 * the stream replays the newest window on every (re)connect.
 *
 * Unlike the legacy Vite adapter it also resolves `control_response` /
 * `permission_response`, so approvals race-free regardless of whether the echo
 * arrives over history or live.
 */

import { isSessionClosedStatus } from '../contracts'

// =============================================================================
// Chat model
// =============================================================================

export type ToolCallStatus = 'running' | 'complete' | 'error' | 'waiting_for_confirmation' | 'rejected' | 'canceled'

export type AssistantChunk = { type: 'message'; text: string } | { type: 'thought'; text: string }

export interface PermissionOption {
  optionId: string
  name: string
  kind: string
}

export interface ToolCallData {
  id: string
  title: string
  status: ToolCallStatus
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  /** Present while `status === 'waiting_for_confirmation'`. */
  permissionRequest?: {
    requestId: string
    options: PermissionOption[]
  }
  /** Permission request that had no matching in-flight tool call. */
  isStandalonePermission?: boolean
}

export interface UserMessageEntry {
  type: 'user_message'
  id: string
  content: string
}

export interface AssistantMessageEntry {
  type: 'assistant_message'
  id: string
  chunks: AssistantChunk[]
  /** Transient bubble fed by `stream_event` deltas; replaced by the durable message. */
  streaming?: boolean
}

export interface ToolCallEntry {
  type: 'tool_call'
  toolCall: ToolCallData
}

export type PlanEntryPriority = 'high' | 'medium' | 'low'
export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanEntry {
  content: string
  priority: PlanEntryPriority
  status: PlanEntryStatus
}

export interface PlanDisplayEntry {
  type: 'plan'
  id: string
  entries: PlanEntry[]
}

export type ThreadEntry = UserMessageEntry | AssistantMessageEntry | ToolCallEntry | PlanDisplayEntry

export interface PendingPermission {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  description?: string
}

export interface ChatState {
  entries: ThreadEntry[]
  pendingPermissions: PendingPermission[]
  status: string | null
  closed: boolean
  lastSeqNum: number
  seenSeqNums: Set<number>
  /** Events without a numeric `seqNum` dedupe by uuid instead. */
  seenEventIds: Set<string>
  /**
   * Assistant message uuids already rendered. The bridge replays history into
   * the CLI on every ingress reconnect and the CLI echoes assistant messages
   * back, so the same message arrives again under a fresh durable seqNum.
   * Dedupe by message uuid so the replay does not repeat text in the UI.
   */
  seenAssistantUuids: Set<string>
  error: string | null
}

/**
 * Shape shared by durable history rows and live SSE frames. Both carry a
 * `seqNum`; only history carries the event uuid in `id`.
 */
export interface SessionEventInput {
  id?: string
  seqNum?: number
  type: string
  payload?: unknown
  direction?: 'inbound' | 'outbound'
  sessionId?: string
  createdAt?: number
  receivedAt?: number
  /** Live-only frame (SSE without an `id:`); falls outside the durable sequence. */
  ephemeral?: boolean
}

export const initialChatState: ChatState = {
  entries: [],
  pendingPermissions: [],
  status: null,
  closed: false,
  lastSeqNum: 0,
  seenSeqNums: new Set<number>(),
  seenEventIds: new Set<string>(),
  seenAssistantUuids: new Set<string>(),
  error: null,
}

// =============================================================================
// Payload helpers
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Pull a display string out of a `content` / `message.content` payload. */
export function extractEventText(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return typeof payload === 'string' ? payload : ''

  const content = record.content
  if (typeof content === 'string') return content

  const message = asRecord(record.message)
  if (message) {
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .map((block) => asRecord(block))
        .filter((block): block is Record<string, unknown> => !!block && block.type === 'text')
        .map((block) => asText(block.text))
        .join('')
    }
  }

  return ''
}

function requestIdOf(payload: Record<string, unknown>): string {
  const flat = asText(payload.request_id)
  if (flat) return flat
  const response = asRecord(payload.response)
  return response ? asText(response.request_id) : ''
}

function numericSeqNum(event: SessionEventInput): number | null {
  return typeof event.seqNum === 'number' && Number.isFinite(event.seqNum) ? event.seqNum : null
}

// =============================================================================
// Reducer
// =============================================================================

/**
 * Streaming snapshots are published live without a durable row and never replayed,
 * so they must bypass the seqNum/uuid dedupe bookkeeping entirely.
 */
export function isEphemeralEvent(event: SessionEventInput): boolean {
  return event.ephemeral === true || event.type === 'stream_event'
}

function isDuplicate(state: ChatState, event: SessionEventInput): boolean {
  const seqNum = numericSeqNum(event)
  if (seqNum !== null) return state.seenSeqNums.has(seqNum)
  if (event.id) return state.seenEventIds.has(event.id)
  return false
}

function markSeen(state: ChatState, event: SessionEventInput): ChatState {
  const seqNum = numericSeqNum(event)
  const seenSeqNums = new Set(state.seenSeqNums)
  const seenEventIds = new Set(state.seenEventIds)
  if (seqNum !== null) seenSeqNums.add(seqNum)
  if (event.id) seenEventIds.add(event.id)
  return {
    ...state,
    seenSeqNums,
    seenEventIds,
    lastSeqNum: seqNum !== null ? Math.max(state.lastSeqNum, seqNum) : state.lastSeqNum,
  }
}

function findToolCallIndex(entries: ThreadEntry[], toolCallId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry && entry.type === 'tool_call' && entry.toolCall.id === toolCallId) return i
  }
  return -1
}

function replaceEntry(entries: ThreadEntry[], index: number, entry: ThreadEntry): ThreadEntry[] {
  const next = entries.slice()
  next[index] = entry
  return next
}

const STREAMING_ENTRY_ID = 'streaming'

/** Remove the transient streamed bubble; the durable message replaces it. */
function dropStreaming(state: ChatState): ChatState {
  if (!state.entries.some((entry) => entry.type === 'assistant_message' && entry.streaming)) return state
  return {
    ...state,
    entries: state.entries.filter((entry) => !(entry.type === 'assistant_message' && entry.streaming)),
  }
}

function appendStreaming(state: ChatState, kind: 'message' | 'thought', text: string): ChatState {
  if (!text) return state
  const chunk: AssistantChunk = kind === 'message' ? { type: 'message', text } : { type: 'thought', text }
  const last = state.entries[state.entries.length - 1]

  if (last && last.type === 'assistant_message' && last.streaming) {
    const chunks = last.chunks.slice()
    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk && lastChunk.type === kind) {
      chunks[chunks.length - 1] =
        kind === 'message'
          ? { type: 'message', text: lastChunk.text + text }
          : { type: 'thought', text: lastChunk.text + text }
    } else {
      chunks.push(chunk)
    }
    return { ...state, entries: replaceEntry(state.entries, state.entries.length - 1, { ...last, chunks }) }
  }

  return {
    ...state,
    entries: [
      ...state.entries,
      { type: 'assistant_message', id: STREAMING_ENTRY_ID, chunks: [chunk], streaming: true },
    ],
  }
}

function appendAssistantText(entries: ThreadEntry[], text: string, eventId: string): ThreadEntry[] {
  const last = entries[entries.length - 1]
  if (last && last.type === 'assistant_message') {
    const chunks = last.chunks.slice()
    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk && lastChunk.type === 'message') {
      chunks[chunks.length - 1] = { type: 'message', text: lastChunk.text + text }
    } else {
      chunks.push({ type: 'message', text })
    }
    return replaceEntry(entries, entries.length - 1, { ...last, chunks })
  }

  return [...entries, { type: 'assistant_message', id: eventId, chunks: [{ type: 'message', text }] }]
}

function collectToolUseBlocks(payload: Record<string, unknown>): Record<string, unknown>[] {
  const message = asRecord(payload.message)
  const content = message && Array.isArray(message.content) ? message.content : payload.content
  if (!Array.isArray(content)) return []
  return content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => !!block && block.type === 'tool_use')
}

function toolCallFromBlock(block: Record<string, unknown>, fallbackId: string): ToolCallEntry {
  const input = asRecord(block.input)
  return {
    type: 'tool_call',
    toolCall: {
      id: asText(block.id) || fallbackId,
      title: asText(block.name) || '',
      status: 'running',
      rawInput: input ?? {},
    },
  }
}

function handleAssistant(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const seqNum = numericSeqNum(event)
  const nextId = event.id || `assistant-${seqNum ?? state.entries.length}`

  // A replayed assistant message carries the uuid it was first rendered under.
  const messageUuid = asText(payload.uuid) || nextId
  if (messageUuid && state.seenAssistantUuids.has(messageUuid)) return state
  const seenAssistantUuids = new Set(state.seenAssistantUuids)
  seenAssistantUuids.add(messageUuid)

  // The durable message supersedes the streamed prefix.
  const base = dropStreaming(state)
  let entries = base.entries
  const text = typeof payload.content === 'string' ? payload.content : extractEventText(payload)
  if (text) entries = appendAssistantText(entries, text, nextId)

  const blocks = collectToolUseBlocks(payload)
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block) continue
    entries = [...entries, toolCallFromBlock(block, `call-${seqNum ?? entries.length}-${i}`)]
  }

  return { ...base, entries, seenAssistantUuids }
}

function handleToolUse(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const seqNum = numericSeqNum(event)
  const id = asText(payload.tool_call_id) || `call-${seqNum ?? state.entries.length}`
  const input = asRecord(payload.tool_input)
  const entry: ToolCallEntry = {
    type: 'tool_call',
    toolCall: {
      id,
      title: asText(payload.tool_name) || '',
      status: 'running',
      rawInput: input ?? {},
    },
  }
  return { ...state, entries: [...state.entries, entry] }
}

function mostRecentRunningIndex(entries: ThreadEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry && entry.type === 'tool_call' && entry.toolCall.status === 'running') return i
  }
  return -1
}

interface ToolResultBlock {
  id: string
  content: string
  isError: boolean
}

/** Concatenates the text blocks of a tool_result's content. */
function textFromBlocks(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => asRecord(item))
    .filter((block): block is Record<string, unknown> => !!block && block.type === 'text')
    .map((block) => asText(block.text))
    .join('')
}

/**
 * The CLI reports tool results as a synthetic `user` turn whose content is a
 * list of `tool_result` blocks — not as a standalone `tool_result` event. Pull
 * them out so the matching tool card leaves its running state.
 */
function collectUserToolResults(payload: Record<string, unknown>): ToolResultBlock[] {
  const message = asRecord(payload.message)
  const content = message && Array.isArray(message.content) ? message.content : payload.content
  if (!Array.isArray(content)) return []

  const results: ToolResultBlock[] = []
  for (const item of content) {
    const block = asRecord(item)
    if (!block || block.type !== 'tool_result') continue
    const id = asText(block.tool_use_id)
    if (!id) continue
    results.push({ id, content: textFromBlocks(block.content), isError: block.is_error === true })
  }
  return results
}

function settleToolResult(entries: ThreadEntry[], result: ToolResultBlock): ThreadEntry[] {
  const index = findToolCallIndex(entries, result.id)
  if (index < 0) return entries
  const entry = entries[index]
  if (!entry || entry.type !== 'tool_call') return entries
  return replaceEntry(entries, index, {
    type: 'tool_call',
    toolCall: {
      ...entry.toolCall,
      status: result.isError ? 'error' : 'complete',
      rawOutput: { output: result.content },
    },
  })
}

function handleToolResult(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const toolCallId = asText(payload.tool_call_id)
  // An explicitly named call that does not match stays a no-op. A missing/empty
  // id is positional, so fall back to the most recent running call.
  let index = toolCallId ? findToolCallIndex(state.entries, toolCallId) : -1
  if (!toolCallId) index = mostRecentRunningIndex(state.entries)
  if (index < 0) return state

  const entry = state.entries[index]
  if (!entry || entry.type !== 'tool_call') return state

  const output = payload.content ?? payload.output ?? ''
  const next: ToolCallEntry = {
    type: 'tool_call',
    toolCall: {
      ...entry.toolCall,
      status: payload.is_error === true ? 'error' : 'complete',
      rawOutput: { output },
    },
  }
  return { ...state, entries: replaceEntry(state.entries, index, next) }
}

function handlePermissionRequest(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const request = asRecord(payload.request) ?? payload
  const requestId = asText(payload.request_id)
  if (!requestId) return state

  const toolName = asText(request.tool_name) || ''
  const toolInput = asRecord(request.input) ?? asRecord(request.tool_input) ?? {}
  const description = asText(request.description)

  const pendingExists = state.pendingPermissions.some((permission) => permission.requestId === requestId)
  const pendingPermissions = pendingExists
    ? state.pendingPermissions
    : [...state.pendingPermissions, { requestId, toolName, toolInput, description }]

  // Already bound to this exact request (replayed frame): don't create a second card.
  const alreadyBound = state.entries.some(
    (entry) => entry.type === 'tool_call' && entry.toolCall.permissionRequest?.requestId === requestId,
  )
  if (alreadyBound) return { ...state, pendingPermissions }

  // Prefer the most recent running call for the same tool; fall back to the
  // most recent running call of any kind. Calls already awaiting confirmation
  // are never rebound to a different request.
  let target = -1
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i]
    if (
      entry &&
      entry.type === 'tool_call' &&
      entry.toolCall.status === 'running' &&
      entry.toolCall.title === toolName
    ) {
      target = i
      break
    }
  }
  if (target < 0) target = mostRecentRunningIndex(state.entries)

  if (target >= 0) {
    const entry = state.entries[target] as ToolCallEntry
    const updated: ToolCallEntry = {
      type: 'tool_call',
      toolCall: {
        ...entry.toolCall,
        status: 'waiting_for_confirmation',
        permissionRequest: { requestId, options: [] },
      },
    }
    return {
      ...state,
      entries: replaceEntry(state.entries, target, updated),
      pendingPermissions,
    }
  }

  const standalone: ToolCallEntry = {
    type: 'tool_call',
    toolCall: {
      id: `permission-${requestId}`,
      title: toolName,
      status: 'waiting_for_confirmation',
      rawInput: toolInput,
      permissionRequest: { requestId, options: [] },
      isStandalonePermission: true,
    },
  }
  return {
    ...state,
    entries: [...state.entries, standalone],
    pendingPermissions,
  }
}

function handlePermissionResponse(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const requestId = requestIdOf(payload)
  if (!requestId) return state

  const approved = payload.approved === true
  const pendingPermissions = state.pendingPermissions.filter((permission) => permission.requestId !== requestId)

  let changed = pendingPermissions.length !== state.pendingPermissions.length
  const entries = state.entries.map((entry) => {
    if (entry.type !== 'tool_call') return entry
    if (entry.toolCall.permissionRequest?.requestId !== requestId) return entry
    changed = true
    // A standalone card has no tool call behind it, so it will never receive a
    // `tool_result`; settle it here (approved → complete, denied → rejected).
    const status: ToolCallStatus = entry.toolCall.isStandalonePermission
      ? approved
        ? 'complete'
        : 'rejected'
      : approved
        ? 'running'
        : 'rejected'
    return {
      type: 'tool_call' as const,
      toolCall: {
        ...entry.toolCall,
        status,
        permissionRequest: undefined,
        isStandalonePermission: undefined,
      },
    }
  })

  return changed ? { ...state, entries, pendingPermissions } : { ...state, pendingPermissions }
}

function handleSessionStatus(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const status = asText(payload.status)
  if (!status) return state
  // The turn stopped (idle/archived/inactive): any in-flight stream is stale.
  const base = status === 'running' ? state : dropStreaming(state)
  return { ...base, status, closed: isSessionClosedStatus(status) }
}

/**
 * Locate the raw SDK stream event inside a `stream_event` payload.
 *
 * Raw frames wrap it under `event`. The gateway's `normalizePayload` stores every
 * inbound message as `{ content, raw }` before publishing it, so the live SSE stream
 * nests the SDK message under `raw` and the event under `raw.event`.
 */
function streamEventOf(payload: Record<string, unknown>): Record<string, unknown> {
  const direct = asRecord(payload.event)
  if (direct) return direct
  const nested = asRecord(asRecord(payload.raw)?.event)
  if (nested) return nested
  return payload
}

/** `stream_event` payloads wrap the raw SDK event under `event`. */
function handleStreamEvent(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const stream = streamEventOf(payload)
  const type = asText(stream.type)

  if (type === 'message_start') return dropStreaming(state)
  if (type !== 'content_block_delta') return state

  const delta = asRecord(stream.delta)
  if (!delta) return state
  if (delta.type === 'text_delta') return appendStreaming(state, 'message', asText(delta.text))
  if (delta.type === 'thinking_delta') return appendStreaming(state, 'thought', asText(delta.thinking))
  return state
}

function handleResult(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const base = dropStreaming(state)
  const subtype = asText(payload.subtype)
  if (!subtype || subtype === 'success') return { ...base, error: null }
  return { ...base, error: asText(payload.result) || subtype }
}

function handleError(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const message = asText(payload.message) || asText(payload.content) || ''
  return { ...state, error: message }
}

function handlePlan(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const raw = Array.isArray(payload.entries) ? payload.entries : []
  const entries: PlanEntry[] = raw
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      content: asText(item.content),
      priority: (item.priority === 'high' || item.priority === 'low' ? item.priority : 'medium') as PlanEntryPriority,
      status: (item.status === 'completed' || item.status === 'in_progress'
        ? item.status
        : 'pending') as PlanEntryStatus,
    }))
  if (entries.length === 0) return state

  const seqNum = numericSeqNum(event)
  const planEntry: PlanDisplayEntry = {
    type: 'plan',
    id: event.id || `plan-${seqNum ?? state.entries.length}`,
    entries,
  }
  return { ...state, entries: [...state.entries, planEntry] }
}

function applyEvent(state: ChatState, event: SessionEventInput): ChatState {
  switch (event.type) {
    case 'user': {
      // Both directions render: the gateway persists outbound sends as `user`
      // events but does not echo them back inbound, so treating only inbound as
      // displayable would lose every sent message on reload.
      const payload = asRecord(event.payload) ?? {}
      // Replay acknowledgments echo a message the history already holds.
      if (payload.isReplay === true) return state
      let entries = state.entries
      for (const result of collectUserToolResults(payload)) {
        entries = settleToolResult(entries, result)
      }
      const text = extractEventText(event.payload)
      if (!text) return entries === state.entries ? state : { ...state, entries }
      const seqNum = numericSeqNum(event)
      const id = asText(payload.uuid) || (seqNum !== null ? String(seqNum) : event.id || `user-${entries.length}`)
      // Dedupe by uuid: an optimistic send and its history/echo counterpart
      // share the uuid even when their seqNums differ.
      if (entries.some((entry) => entry.type === 'user_message' && entry.id === id)) return { ...state, entries }
      return {
        ...state,
        entries: [...entries, { type: 'user_message', id, content: text }],
        // A new turn starts fresh; the previous failure no longer describes it.
        error: null,
      }
    }
    case 'assistant':
      return handleAssistant(state, event)
    case 'tool_use':
      return handleToolUse(state, event)
    case 'tool_result':
      return handleToolResult(state, event)
    case 'control_request':
    case 'permission_request':
      return handlePermissionRequest(state, event)
    case 'control_response':
    case 'permission_response':
      return handlePermissionResponse(state, event)
    case 'session_status':
      return handleSessionStatus(state, event)
    case 'error':
      return handleError(state, event)
    case 'plan':
      return handlePlan(state, event)
    case 'stream_event':
      return handleStreamEvent(state, event)
    case 'result':
    case 'result_success':
      return handleResult(state, event)
    case 'interrupt':
      return dropStreaming(state)
    default:
      // partial_assistant, system, task_state, automation_state, status, … are
      // intentionally ignored.
      return state
  }
}

/** Fold one history row or live frame into the chat state. */
export function reduceSessionEvent(state: ChatState, event: SessionEventInput): ChatState {
  // Ephemeral frames are never replayed, so they skip the durable dedupe sets.
  if (isEphemeralEvent(event)) return applyEvent(state, event)
  if (isDuplicate(state, event)) return state
  const seeded = markSeen(state, event)
  return applyEvent(seeded, event)
}

/** Durable event types that close the current streamed assistant message. */
const TERMINAL_STREAM_EVENT_TYPES = new Set([
  'assistant',
  'result',
  'result_success',
  'session_status',
  'interrupt',
  'error',
])

/**
 * The live delta window to replay on top of durable history: every ephemeral
 * frame that arrived after the last terminal durable event. Feeding the whole
 * live log would resurrect a finished streamed bubble on each render pass.
 */
export function activeStreamEvents(events: readonly SessionEventInput[]): SessionEventInput[] {
  let start = 0
  for (let i = 0; i < events.length; i++) {
    const candidate = events[i]
    if (candidate && !isEphemeralEvent(candidate) && TERMINAL_STREAM_EVENT_TYPES.has(candidate.type)) start = i + 1
  }
  return events.slice(start).filter(isEphemeralEvent)
}

/** Fold a page of durable history (oldest→newest) through the reducer. */
export function applyHistory(state: ChatState, events: readonly SessionEventInput[]): ChatState {
  let next = state
  for (const event of events) next = reduceSessionEvent(next, event)
  return next
}
