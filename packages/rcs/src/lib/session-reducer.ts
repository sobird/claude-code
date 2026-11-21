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

import { isSessionClosedStatus } from '@/contracts'

import { extractUserAttachments, type AttachmentRef } from './attachments'
import {
  completeBackgroundTask,
  progressBackgroundTask,
  startBackgroundTask,
  type BackgroundTask,
} from './background-tasks'
import { normalizeModel } from './model-settings'
import { isWebPermissionMode, type WebPermissionMode } from './permission-modes'
import type { PermissionSuggestion } from './permission-suggestions'
import { tasksFromTaskState, tasksFromTodoWrite, type TaskItem } from './tasks'
import { thinkingChoiceFromPayload, type ThinkingChoice, type ThinkingState } from './thinking'
import { usageFromPayload, type TokenUsage } from './token-usage'

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
  /** Stored image references rendered from `/web/attachments/:id`. */
  attachments?: AttachmentRef[]
  /** Sent while the agent was running; the CLI processes it after the turn. */
  queued?: boolean
}

export interface AssistantMessageEntry {
  type: 'assistant_message'
  id: string
  chunks: AssistantChunk[]
  /** Transient bubble fed by `stream_event` deltas; replaced by the durable message. */
  streaming?: boolean
  /**
   * Agent tool call this message belongs to. Subagent traffic arrives as
   * ordinary assistant/user messages tagged with `parent_tool_use_id`; the
   * transcript stays flat and the view nests by this pointer.
   */
  parentToolUseId?: string
}

export interface ToolCallEntry {
  type: 'tool_call'
  toolCall: ToolCallData
  /** Agent tool call this tool ran under, when issued by a subagent. */
  parentToolUseId?: string
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

/**
 * Marker closing a completed turn; the view renders it as a muted line so the
 * reader can see how long the CLI worked (history uses server timestamps).
 */
export interface TurnEndEntry {
  type: 'turn_end'
  id: string
  durationMs: number
}

/**
 * Informational transcript row (compaction, API errors, hook summaries, …),
 * rendered only while the detailed-transcript toggle is on.
 */
export interface SystemEntry {
  type: 'system'
  id: string
  subtype: string
  content?: string
  level?: string
  commands?: string[]
  writtenPaths?: string[]
  /** Final status on a `task_notification` row. */
  taskStatus?: string
}

export type ThreadEntry =
  | UserMessageEntry
  | AssistantMessageEntry
  | ToolCallEntry
  | PlanDisplayEntry
  | SystemEntry
  | TurnEndEntry

export interface PendingPermission {
  requestId: string
  toolUseId?: string
  toolName: string
  toolInput: Record<string, unknown>
  description?: string
  /** CLI-proposed PermissionUpdate objects ("always allow …"). */
  suggestions: PermissionSuggestion[]
  /** Path that made the permission check fail, when the CLI reports one. */
  blockedPath?: string
  /** Free-text explanation from the CLI (not forwarded by the bridge today). */
  decisionReason?: string
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
  /** Bridge-safe slash commands from the latest `system/init` (empty until one arrives). */
  slashCommands: string[]
  /** Current CLI permission mode from `system/init`; `null` hides the mode control. */
  permissionMode: string | null
  /** Mode switch sent but not yet acknowledged by the CLI. */
  pendingMode: { requestId: string; mode: WebPermissionMode } | null
  /** CLI rejection of the last mode switch (e.g. bypass is disabled). */
  modeError: string | null
  /** Current model from `system/init`; `null` means the CLI default (or not yet reported). */
  model: string | null
  /** Model switch sent but not yet acknowledged by the CLI; `null` model resets to default. */
  pendingModel: { requestId: string; model: string | null } | null
  /** CLI rejection of the last model switch. */
  modelError: string | null
  /**
   * Last web-requested thinking state the CLI confirmed; `null` is the CLI
   * default (or unknown — `system/init` carries no thinking state).
   */
  thinking: ThinkingState
  /** Thinking switch sent but not yet acknowledged by the CLI. */
  pendingThinking: { requestId: string; choice: ThinkingChoice } | null
  /** CLI rejection of the last thinking switch. */
  thinkingError: string | null
  /**
   * `stop_task` requests awaiting a control_response, keyed by request id to
   * task id. The reply itself closes the row: a killed task may not send a
   * `task_notification` (the CLI suppresses it for shells), and an error
   * reply means no live task exists under that id anyway.
   */
  pendingStops: Record<string, string>
  /** Wall-clock start of the running turn, from the newest user message. */
  turnStartedAt: number | null
  /** True between a turn's first event and its `result`; gates the queued hint. */
  turnOpen: boolean
  /** Latest task list from `TodoWrite` (or an upstream `task_state` payload). */
  tasks: TaskItem[]
  /** Background tasks (agents, workflows) the CLI is still running. */
  backgroundTasks: BackgroundTask[]
  /** Usage of the most recent assistant message; `null` until one reports it. */
  lastUsage: TokenUsage | null
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
  slashCommands: [],
  permissionMode: null,
  pendingMode: null,
  modeError: null,
  model: null,
  pendingModel: null,
  modelError: null,
  thinking: null,
  pendingThinking: null,
  thinkingError: null,
  pendingStops: {},
  turnStartedAt: null,
  turnOpen: false,
  tasks: [],
  backgroundTasks: [],
  lastUsage: null,
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

/**
 * Parent Agent tool call id for subagent traffic. The CLI puts
 * `parent_tool_use_id` at the top level of derived assistant/user messages;
 * the gateway's `normalizePayload` keeps the original under `raw`, so read
 * either shape.
 */
function parentToolUseIdOf(payload: Record<string, unknown>): string | undefined {
  const direct = asText(payload.parent_tool_use_id)
  if (direct) return direct
  const nested = asText(asRecord(payload.raw)?.parent_tool_use_id)
  return nested || undefined
}

/**
 * Server time for history rows, client receive time for live frames: durable
 * rows carry `createdAt`, SSE frames only `receivedAt`.
 */
function eventTimeOf(event: SessionEventInput): number | null {
  for (const value of [event.createdAt, event.receivedAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
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

/** Transient bubble id per thread; the main thread keeps the historical id. */
function streamingEntryId(parentToolUseId?: string): string {
  return parentToolUseId ? `${STREAMING_ENTRY_ID}:${parentToolUseId}` : STREAMING_ENTRY_ID
}

function isStreamingEntry(entry: ThreadEntry, parentToolUseId?: string): entry is AssistantMessageEntry {
  return entry.type === 'assistant_message' && entry.streaming === true && entry.parentToolUseId === parentToolUseId
}

/**
 * Remove the transient streamed bubble for one thread (`undefined` = main thread);
 * the durable message replaces it. Threads stream independently, so a durable
 * subagent message must not clear the main-thread prefix.
 */
function dropThreadStreaming(state: ChatState, parentToolUseId?: string): ChatState {
  if (!state.entries.some((entry) => isStreamingEntry(entry, parentToolUseId))) return state
  return { ...state, entries: state.entries.filter((entry) => !isStreamingEntry(entry, parentToolUseId)) }
}

/** The turn ended or was interrupted: every thread's streamed bubble is stale. */
function dropAllStreaming(state: ChatState): ChatState {
  if (!state.entries.some((entry) => entry.type === 'assistant_message' && entry.streaming)) return state
  return {
    ...state,
    entries: state.entries.filter((entry) => !(entry.type === 'assistant_message' && entry.streaming)),
  }
}

/**
 * Append a delta to its thread's transient bubble. Threads interleave in the
 * flat transcript, so the bubble is located by parent pointer rather than by
 * position — a subagent delta never merges into the main thread's text.
 */
function appendStreaming(
  state: ChatState,
  kind: 'message' | 'thought',
  text: string,
  parentToolUseId?: string,
): ChatState {
  if (!text) return state
  const chunk: AssistantChunk = kind === 'message' ? { type: 'message', text } : { type: 'thought', text }

  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i]
    if (!entry || !isStreamingEntry(entry, parentToolUseId)) continue
    const chunks = entry.chunks.slice()
    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk && lastChunk.type === kind) {
      chunks[chunks.length - 1] =
        kind === 'message'
          ? { type: 'message', text: lastChunk.text + text }
          : { type: 'thought', text: lastChunk.text + text }
    } else {
      chunks.push(chunk)
    }
    return { ...state, entries: replaceEntry(state.entries, i, { ...entry, chunks }) }
  }

  return {
    ...state,
    entries: [
      ...state.entries,
      {
        type: 'assistant_message',
        id: streamingEntryId(parentToolUseId),
        chunks: [chunk],
        streaming: true,
        ...(parentToolUseId ? { parentToolUseId } : {}),
      },
    ],
  }
}

function appendAssistantText(
  entries: ThreadEntry[],
  text: string,
  eventId: string,
  parentToolUseId?: string,
): ThreadEntry[] {
  const last = entries[entries.length - 1]
  // Only continue a message from the same thread; a subagent turn never
  // appends into the main-thread bubble (or into another agent's).
  if (last && last.type === 'assistant_message' && last.parentToolUseId === parentToolUseId) {
    const chunks = last.chunks.slice()
    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk && lastChunk.type === 'message') {
      chunks[chunks.length - 1] = { type: 'message', text: lastChunk.text + text }
    } else {
      chunks.push({ type: 'message', text })
    }
    return replaceEntry(entries, entries.length - 1, { ...last, chunks })
  }

  return [
    ...entries,
    {
      type: 'assistant_message',
      id: eventId,
      chunks: [{ type: 'message', text }],
      ...(parentToolUseId ? { parentToolUseId } : {}),
    },
  ]
}

function collectToolUseBlocks(payload: Record<string, unknown>): Record<string, unknown>[] {
  const message = asRecord(payload.message)
  const content = message && Array.isArray(message.content) ? message.content : payload.content
  if (!Array.isArray(content)) return []
  return content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => !!block && block.type === 'tool_use')
}

function toolCallFromBlock(
  block: Record<string, unknown>,
  fallbackId: string,
  parentToolUseId?: string,
): ToolCallEntry {
  const input = asRecord(block.input)
  return {
    type: 'tool_call',
    toolCall: {
      id: asText(block.id) || fallbackId,
      title: asText(block.name) || '',
      status: 'running',
      rawInput: input ?? {},
    },
    ...(parentToolUseId ? { parentToolUseId } : {}),
  }
}

function handleAssistant(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const seqNum = numericSeqNum(event)
  const nextId = event.id || `assistant-${seqNum ?? state.entries.length}`
  const parentToolUseId = parentToolUseIdOf(payload)

  // A replayed assistant message carries the uuid it was first rendered under.
  const messageUuid = asText(payload.uuid) || nextId
  if (messageUuid && state.seenAssistantUuids.has(messageUuid)) return state
  const seenAssistantUuids = new Set(state.seenAssistantUuids)
  seenAssistantUuids.add(messageUuid)

  // A durable message supersedes its own thread's streamed prefix; other threads'
  // bubbles (main vs. subagent) keep streaming.
  const base = dropThreadStreaming(state, parentToolUseId)
  let entries = base.entries
  const text = typeof payload.content === 'string' ? payload.content : extractEventText(payload)
  if (text) entries = appendAssistantText(entries, text, nextId, parentToolUseId)

  const blocks = collectToolUseBlocks(payload)
  let tasks = base.tasks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block) continue
    const entry = toolCallFromBlock(block, `call-${seqNum ?? entries.length}-${i}`, parentToolUseId)
    entries = [...entries, entry]
    if (entry.toolCall.title === 'TodoWrite') {
      const parsed = tasksFromTodoWrite(entry.toolCall.rawInput)
      if (parsed) tasks = parsed
    }
  }

  return {
    ...base,
    entries,
    seenAssistantUuids,
    tasks,
    lastUsage: usageFromPayload(payload) ?? base.lastUsage,
    turnOpen: true,
  }
}

function handleToolUse(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const seqNum = numericSeqNum(event)
  const id = asText(payload.tool_call_id) || `call-${seqNum ?? state.entries.length}`
  const input = asRecord(payload.tool_input)
  const title = asText(payload.tool_name) || ''
  const parentToolUseId = parentToolUseIdOf(payload)
  const entry: ToolCallEntry = {
    type: 'tool_call',
    toolCall: {
      id,
      title,
      status: 'running',
      rawInput: input ?? {},
    },
    ...(parentToolUseId ? { parentToolUseId } : {}),
  }
  const parsedTasks = title === 'TodoWrite' ? tasksFromTodoWrite(input) : null
  return { ...state, entries: [...state.entries, entry], ...(parsedTasks ? { tasks: parsedTasks } : {}) }
}

function mostRecentRunningIndex(entries: ThreadEntry[], parentToolUseId?: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (
      entry &&
      entry.type === 'tool_call' &&
      entry.toolCall.status === 'running' &&
      entry.parentToolUseId === parentToolUseId
    ) {
      return i
    }
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
    ...entry,
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
  // id is positional, so fall back to the most recent running call in the same
  // thread — subagent calls interleave in the flat transcript.
  let index = toolCallId ? findToolCallIndex(state.entries, toolCallId) : -1
  if (!toolCallId) index = mostRecentRunningIndex(state.entries, parentToolUseIdOf(payload))
  if (index < 0) return state

  const entry = state.entries[index]
  if (!entry || entry.type !== 'tool_call') return state

  const output = payload.content ?? payload.output ?? ''
  const next: ToolCallEntry = {
    ...entry,
    toolCall: {
      ...entry.toolCall,
      status: payload.is_error === true ? 'error' : 'complete',
      rawOutput: { output },
    },
  }
  return { ...state, entries: replaceEntry(state.entries, index, next) }
}

/**
 * Background shells (`local_bash`) outlive the turn that started them: the CLI
 * only holds `result` back for agents/workflows, so clearing on a turn end must
 * keep them until their own `task_notification`.
 */
function retainPersistentTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  const kept = tasks.filter((task) => task.taskType === 'local_bash')
  return kept.length === tasks.length ? tasks : kept
}

/** Informational system subtypes the detailed transcript renders as rows. */
const SYSTEM_ROW_SUBTYPES = new Set([
  'compact_boundary',
  'microcompact_boundary',
  'local_command',
  'api_error',
  'memory_saved',
  'stop_hook_summary',
  'permission_retry',
  'task_notification',
])

/**
 * `system/init` carries the bridge-safe slash commands and the current
 * permission mode; `system/status` reports the live mode after a change the
 * web did not initiate (e.g. approving ExitPlanMode with auto-accept edits).
 * The informational subtypes in SYSTEM_ROW_SUBTYPES become transcript rows;
 * everything else is still ignored.
 *
 * A reconnect re-sends init, so a later message simply replaces the previous
 * snapshot (history replays fold in sequence order).
 */
function handleSystemEvent(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const subtype = asText(payload.subtype)

  if (subtype === 'status') {
    // Status carries no commands, so only the mode moves; an unrecognized value
    // (e.g. CLI-only `auto`) leaves the last known mode in place.
    if (!isWebPermissionMode(payload.permissionMode) || payload.permissionMode === state.permissionMode) return state
    return { ...state, permissionMode: payload.permissionMode }
  }

  if (subtype === 'init') {
    const slashCommands = Array.isArray(payload.slash_commands)
      ? [
          ...new Set(payload.slash_commands.filter((item): item is string => typeof item === 'string' && item !== '')),
        ].slice(0, 100)
      : state.slashCommands
    const permissionMode = isWebPermissionMode(payload.permissionMode) ? payload.permissionMode : state.permissionMode
    // A missing/invalid model keeps the last known one; the CLI always sends it in init.
    const model = normalizeModel(payload.model) ?? state.model

    return {
      ...state,
      slashCommands,
      permissionMode,
      pendingMode: null,
      modeError: null,
      model,
      pendingModel: null,
      modelError: null,
    }
  }

  // Background-task lifecycle. `task_started` opens the turn window the queue
  // hint keys off: the CLI holds `result` back while these tasks run.
  if (subtype === 'task_started') {
    return {
      ...state,
      backgroundTasks: startBackgroundTask(state.backgroundTasks, payload, eventTimeOf(event)),
      turnOpen: true,
    }
  }

  if (subtype === 'task_progress') {
    const backgroundTasks = progressBackgroundTask(state.backgroundTasks, payload, eventTimeOf(event))
    return backgroundTasks === state.backgroundTasks ? state : { ...state, backgroundTasks }
  }

  let backgroundTasks = state.backgroundTasks
  if (subtype === 'task_notification') {
    backgroundTasks = completeBackgroundTask(backgroundTasks, asText(payload.task_id))
  }

  // `session_state_changed` is the CLI's own liveness claim. Going idle ends the
  // turn-scoped tasks (agents/workflows hold `result` back, so they are already
  // gone); background shells keep running. The turn state stays owned by
  // result/session_status.
  if (subtype === 'session_state_changed') {
    if (payload.state !== 'idle' || state.backgroundTasks.length === 0) return state
    const backgroundTasks = retainPersistentTasks(state.backgroundTasks)
    return backgroundTasks === state.backgroundTasks ? state : { ...state, backgroundTasks }
  }

  if (!SYSTEM_ROW_SUBTYPES.has(subtype)) return state

  const seqNum = numericSeqNum(event)
  const content =
    subtype === 'task_notification'
      ? asText(payload.summary) || asText(payload.description) || asText(payload.content)
      : asText(payload.content)
  const entry: SystemEntry = {
    type: 'system',
    id: event.id || (seqNum !== null ? `system-${seqNum}` : `system-${state.entries.length}`),
    subtype,
    ...(content ? { content } : {}),
    ...(typeof payload.level === 'string' ? { level: payload.level } : {}),
    ...(Array.isArray(payload.commands)
      ? { commands: payload.commands.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(Array.isArray(payload.writtenPaths)
      ? { writtenPaths: payload.writtenPaths.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(subtype === 'task_notification' && typeof payload.status === 'string' ? { taskStatus: payload.status } : {}),
  }
  return { ...state, backgroundTasks, entries: [...state.entries, entry] }
}

function handlePermissionRequest(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const request = asRecord(payload.request) ?? payload
  const requestId = asText(payload.request_id)
  if (!requestId) return state

  // Non-permission control requests share the envelope. `set_permission_mode`
  // and `set_model` are echoed back as outbound events, so they double as the
  // pending trackers for their respective switches.
  const subtype = asText(request.subtype)
  if (subtype && subtype !== 'can_use_tool') {
    if (subtype === 'set_model') {
      return { ...state, pendingModel: { requestId, model: normalizeModel(request.model) }, modelError: null }
    }
    if (subtype === 'stop_task') {
      // Remember which row the web asked to stop: the CLI answers with a
      // control_response instead of a task_notification here (the child only
      // bookends tasks it kills; an already-finished task is an error reply).
      const taskId = asText(request.task_id)
      if (!taskId) return state
      return { ...state, pendingStops: { ...state.pendingStops, [requestId]: taskId } }
    }
    if (subtype === 'set_max_thinking_tokens') {
      // The echoed request carries the budget the web sent: null = default,
      // 0 = off, >0 = on.
      const raw = request.max_thinking_tokens
      const choice: ThinkingChoice =
        raw === null || raw === undefined ? 'default' : (thinkingChoiceFromPayload(raw) ?? 'default')
      return { ...state, pendingThinking: { requestId, choice }, thinkingError: null }
    }
    if (subtype !== 'set_permission_mode' || !isWebPermissionMode(request.mode)) return state
    return { ...state, pendingMode: { requestId, mode: request.mode }, modeError: null }
  }

  const toolName = asText(request.tool_name) || ''
  const toolInput = asRecord(request.input) ?? asRecord(request.tool_input) ?? {}
  const description = asText(request.description)
  const suggestions = Array.isArray(request.permission_suggestions)
    ? (request.permission_suggestions.filter((item) => !!asRecord(item)) as unknown as PermissionSuggestion[])
    : []
  const toolUseId = asText(request.tool_use_id)
  const blockedPath = asText(request.blocked_path)
  const decisionReason = asText(request.decision_reason)

  const pendingExists = state.pendingPermissions.some((permission) => permission.requestId === requestId)
  const pendingPermissions = pendingExists
    ? state.pendingPermissions
    : [
        ...state.pendingPermissions,
        {
          requestId,
          ...(toolUseId ? { toolUseId } : {}),
          toolName,
          toolInput,
          ...(description ? { description } : {}),
          suggestions,
          ...(blockedPath ? { blockedPath } : {}),
          ...(decisionReason ? { decisionReason } : {}),
        },
      ]

  // Already bound to this exact request (replayed frame): don't create a second card.
  const alreadyBound = state.entries.some(
    (entry) => entry.type === 'tool_call' && entry.toolCall.permissionRequest?.requestId === requestId,
  )
  if (alreadyBound) return { ...state, pendingPermissions }

  // Prefer the most recent running call for the same tool; fall back to the
  // most recent running call in the same thread (subagent calls interleave in
  // the flat transcript). Calls already awaiting confirmation are never
  // rebound to a different request.
  const parentToolUseId = parentToolUseIdOf(payload)
  let target = -1
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i]
    if (
      entry &&
      entry.type === 'tool_call' &&
      entry.toolCall.status === 'running' &&
      entry.toolCall.title === toolName &&
      entry.parentToolUseId === parentToolUseId
    ) {
      target = i
      break
    }
  }
  if (target < 0) target = mostRecentRunningIndex(state.entries, parentToolUseId)

  if (target >= 0) {
    const entry = state.entries[target] as ToolCallEntry
    const updated: ToolCallEntry = {
      ...entry,
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
    ...(parentToolUseId ? { parentToolUseId } : {}),
  }
  return {
    ...state,
    entries: [...state.entries, standalone],
    pendingPermissions,
  }
}

/** The CLI's control_response nests its outcome under `response`. */
function responseOutcome(payload: Record<string, unknown>): { subtype: string; error: string } {
  const response = asRecord(payload.response) ?? {}
  return {
    subtype: asText(response.subtype) || asText(payload.subtype),
    error: asText(response.error) || asText(payload.error),
  }
}

function handlePermissionResponse(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const requestId = requestIdOf(payload)
  if (!requestId) return state

  // A stop_task reply is authoritative either way: success means the CLI
  // killed the task (and some CLI versions suppress the closing
  // task_notification for killed shells, so waiting for it would keep the
  // row up forever), error means it never had a live task. Drop the row now;
  // a late notification is a no-op and still appends its transcript row.
  const stoppedTaskId = state.pendingStops[requestId]
  if (stoppedTaskId !== undefined) {
    const { [requestId]: _, ...pendingStops } = state.pendingStops
    return {
      ...state,
      pendingStops,
      backgroundTasks: completeBackgroundTask(state.backgroundTasks, stoppedTaskId),
    }
  }

  // A mode switch resolves against pendingMode, not against a permission card.
  const pendingMode = state.pendingMode
  if (pendingMode && pendingMode.requestId === requestId) {
    const outcome = responseOutcome(payload)
    if (outcome.subtype === 'error') {
      return { ...state, pendingMode: null, modeError: outcome.error || 'set_permission_mode failed' }
    }
    return { ...state, pendingMode: null, modeError: null, permissionMode: pendingMode.mode }
  }

  // Likewise for a model switch. The success reply carries no model, so adopt the
  // requested value; the next `system/init` corrects any alias the CLI normalized.
  const pendingModel = state.pendingModel
  if (pendingModel && pendingModel.requestId === requestId) {
    const outcome = responseOutcome(payload)
    if (outcome.subtype === 'error') {
      return { ...state, pendingModel: null, modelError: outcome.error || 'set_model failed' }
    }
    return { ...state, pendingModel: null, modelError: null, model: pendingModel.model }
  }

  // And for a thinking switch. `default` clears the adopted state; the CLI does
  // not echo the effective budget, so this only remembers the web's last choice.
  const pendingThinking = state.pendingThinking
  if (pendingThinking && pendingThinking.requestId === requestId) {
    const outcome = responseOutcome(payload)
    if (outcome.subtype === 'error') {
      return { ...state, pendingThinking: null, thinkingError: outcome.error || 'set_max_thinking_tokens failed' }
    }
    return {
      ...state,
      pendingThinking: null,
      thinkingError: null,
      thinking: pendingThinking.choice === 'default' ? null : pendingThinking.choice,
    }
  }

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
      ...entry,
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

/**
 * The CLI resolved a request locally (hook/classifier/recheck) and cancelled it
 * instead of answering. Drop the matching card so it stops blocking the UI; a
 * bound tool call resumes as running, a standalone card disappears.
 */
function handleControlCancel(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const requestId = requestIdOf(payload)
  if (!requestId) return state

  let changed = false

  let pendingMode = state.pendingMode
  let modeError = state.modeError
  if (pendingMode && pendingMode.requestId === requestId) {
    pendingMode = null
    modeError = null
    changed = true
  }

  let pendingModel = state.pendingModel
  if (pendingModel && pendingModel.requestId === requestId) {
    pendingModel = null
    changed = true
  }

  let pendingThinking = state.pendingThinking
  if (pendingThinking && pendingThinking.requestId === requestId) {
    pendingThinking = null
    changed = true
  }

  let pendingPermissions = state.pendingPermissions
  if (pendingPermissions.some((permission) => permission.requestId === requestId)) {
    pendingPermissions = pendingPermissions.filter((permission) => permission.requestId !== requestId)
    changed = true
  }

  let entries = state.entries
  if (
    entries.some((entry) => entry.type === 'tool_call' && entry.toolCall.permissionRequest?.requestId === requestId)
  ) {
    entries = entries.flatMap((entry) => {
      if (entry.type !== 'tool_call' || entry.toolCall.permissionRequest?.requestId !== requestId) return [entry]
      if (entry.toolCall.isStandalonePermission) return []
      return [
        {
          ...entry,
          toolCall: { ...entry.toolCall, status: 'running' as const, permissionRequest: undefined },
        },
      ]
    })
    changed = true
  }

  return changed
    ? { ...state, pendingPermissions, pendingMode, modeError, pendingModel, pendingThinking, entries }
    : state
}

function handleSessionStatus(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const status = asText(payload.status)
  if (!status) return state
  // The turn stopped (idle/archived/inactive): any in-flight stream is stale.
  const base = status === 'running' ? state : dropAllStreaming(state)
  // A reported non-running state ends the queue window even if no result event
  // arrived (crashed or interrupted turns).
  const turnOpen = status === 'running' || status === 'requires_action'
  const closed = isSessionClosedStatus(status)
  return { ...base, status, closed, turnOpen, backgroundTasks: closed ? [] : state.backgroundTasks }
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

/**
 * `stream_event` payloads wrap the raw SDK event under `event`. Deltas are
 * keyed by their thread (`parent_tool_use_id`): main-thread text streams in the
 * plain bubble, while subagent text streams inside its own Agent card.
 */
function handleStreamEvent(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const parentToolUseId = parentToolUseIdOf(payload)
  const stream = streamEventOf(payload)
  const type = asText(stream.type)

  if (type === 'message_start') return dropThreadStreaming(state, parentToolUseId)
  if (type !== 'content_block_delta') return state

  const delta = asRecord(stream.delta)
  if (!delta) return state
  if (delta.type === 'text_delta') return appendStreaming(state, 'message', asText(delta.text), parentToolUseId)
  if (delta.type === 'thinking_delta') return appendStreaming(state, 'thought', asText(delta.thinking), parentToolUseId)
  return state
}

function handleResult(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const base = dropAllStreaming(state)

  // Close the running turn with its wall-clock length. The marker is dropped
  // when the start time is unknown (e.g. history older than the first page).
  let entries = base.entries

  // The CLI picks up messages queued during this turn as soon as it ends.
  if (entries.some((entry) => entry.type === 'user_message' && entry.queued)) {
    entries = entries.map((entry) =>
      entry.type === 'user_message' && entry.queued ? { ...entry, queued: undefined } : entry,
    )
  }
  const endedAt = eventTimeOf(event)
  if (base.turnStartedAt !== null && endedAt !== null) {
    const seqNum = numericSeqNum(event)
    const id = asText(payload.uuid) || event.id || (seqNum !== null ? `result-${seqNum}` : '')
    if (id) {
      entries = [...entries, { type: 'turn_end', id, durationMs: Math.max(0, endedAt - base.turnStartedAt) }]
    }
  }
  // A result ends the turn; agents/workflows finished (they hold `result` back),
  // but background shells may still be serving.
  const closed = {
    ...base,
    entries,
    turnStartedAt: null,
    turnOpen: false,
    backgroundTasks: retainPersistentTasks(state.backgroundTasks),
  }

  const subtype = asText(payload.subtype)
  if (!subtype || subtype === 'success') return { ...closed, error: null }
  return { ...closed, error: asText(payload.result) || subtype }
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
      // A subagent's user turn carries its tool results (and sometimes meta
      // text); it is not a prompt the user typed, so it gets no bubble.
      if (parentToolUseIdOf(payload)) return entries === state.entries ? state : { ...state, entries }
      const text = extractEventText(event.payload)
      // Image-only prompts have no text projection but still render.
      const attachments = extractUserAttachments(event.payload)
      if (!text && attachments.length === 0) return entries === state.entries ? state : { ...state, entries }
      const seqNum = numericSeqNum(event)
      const id = asText(payload.uuid) || (seqNum !== null ? String(seqNum) : event.id || `user-${entries.length}`)
      // Dedupe by uuid: an optimistic send and its history/echo counterpart
      // share the uuid even when their seqNums differ.
      if (entries.some((entry) => entry.type === 'user_message' && entry.id === id)) return { ...state, entries }
      const startedAt = eventTimeOf(event)
      // Queued = the CLI is mid-turn. Bridges do not always publish
      // session_status, so an open turn is the reliable signal.
      const queued = state.status === 'running' || state.turnOpen
      return {
        ...state,
        entries: [
          ...entries,
          {
            type: 'user_message',
            id,
            content: text,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(queued ? { queued: true } : {}),
          },
        ],
        // A new turn starts fresh; the previous failure no longer describes it.
        error: null,
        turnStartedAt: startedAt ?? state.turnStartedAt,
        turnOpen: true,
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
    case 'control_cancel_request':
      return handleControlCancel(state, event)
    case 'task_state': {
      const parsed = tasksFromTaskState(asRecord(event.payload) ?? {})
      return parsed ? { ...state, tasks: parsed } : state
    }
    case 'session_status':
      return handleSessionStatus(state, event)
    case 'system':
      return handleSystemEvent(state, event)
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
      return dropAllStreaming(state)
    default:
      // partial_assistant, automation_state, status, … are intentionally
      // ignored. Background-task lifecycle rides on `system` subtypes.
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
 *
 * Windows are per thread: a durable assistant message retires only its own
 * thread's prefix (a subagent finishing must not blank the main stream, and
 * vice versa), while turn-ending events close every thread.
 */
export function activeStreamEvents(events: readonly SessionEventInput[]): SessionEventInput[] {
  let globalStart = 0
  const threadStarts = new Map<string, number>()

  // First pass: the last cut per thread (and the last turn-ending cut overall).
  for (let i = 0; i < events.length; i++) {
    const candidate = events[i]
    if (!candidate || isEphemeralEvent(candidate)) continue
    if (!TERMINAL_STREAM_EVENT_TYPES.has(candidate.type)) continue
    if (candidate.type === 'assistant') {
      threadStarts.set(parentToolUseIdOf(asRecord(candidate.payload) ?? {}) ?? '', i + 1)
    } else {
      globalStart = i + 1
      threadStarts.clear()
    }
  }

  // Second pass: frames that survived every cut applying to their thread.
  return events.filter((candidate, i) => {
    if (!isEphemeralEvent(candidate)) return false
    const thread = parentToolUseIdOf(asRecord(candidate.payload) ?? {}) ?? ''
    return i >= globalStart && i >= (threadStarts.get(thread) ?? 0)
  })
}

/** Fold a page of durable history (oldest→newest) through the reducer. */
export function applyHistory(state: ChatState, events: readonly SessionEventInput[]): ChatState {
  let next = state
  for (const event of events) next = reduceSessionEvent(next, event)
  return next
}
