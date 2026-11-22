/**
 * 会话详情视图的纯聊天 reducer。
 *
 * 把持久历史（`GET /web/sessions/:id/history`）与实时 SSE 帧
 * （`useSessionStream`）折叠成一个 `ThreadEntry[]` 模型。它不依赖 React，以便对
 * 折叠语义做单元测试；它按持久化 `seqNum` 去重，因为流在每次（重）连接时都会重放
 * 最新窗口。
 *
 * 与旧的 Vite adapter 不同，它还会结算 `control_response` /
 * `permission_response`，因此无论回显来自历史还是实时，审批都不会产生竞态。
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
// 聊天模型
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
  /** 在 `status === 'waiting_for_confirmation'` 时存在。 */
  permissionRequest?: {
    requestId: string
    options: PermissionOption[]
  }
  /** 没有匹配到在途工具调用的权限请求。 */
  isStandalonePermission?: boolean
}

export interface UserMessageEntry {
  type: 'user_message'
  id: string
  content: string
  /** 从 `/web/attachments/:id` 渲染的已存储图片引用。 */
  attachments?: AttachmentRef[]
  /** 在 agent 运行期间发送；CLI 会在本轮结束后处理它。 */
  queued?: boolean
}

export interface AssistantMessageEntry {
  type: 'assistant_message'
  id: string
  chunks: AssistantChunk[]
  /** 由 `stream_event` 增量填充的临时气泡；会被持久消息取代。 */
  streaming?: boolean
  /**
   * 此消息所属的 agent 工具调用。subagent 流量以普通 assistant/user 消息形式
   * 到达，并带有 `parent_tool_use_id` 标签；transcript 保持扁平，视图按此指针嵌套。
   */
  parentToolUseId?: string
}

export interface ToolCallEntry {
  type: 'tool_call'
  toolCall: ToolCallData
  /** 该工具运行所在的 agent 工具调用（由 subagent 发起时）。 */
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
 * 结束一轮已完成对话的标记；视图将其渲染为一行浅色文本，让读者看到
 * CLI 工作了多久（历史使用服务器时间戳）。
 */
export interface TurnEndEntry {
  type: 'turn_end'
  id: string
  durationMs: number
}

/**
 * 信息性的 transcript 行（压缩、API 错误、hook 摘要……），
 * 仅在详细 transcript 开关开启时渲染。
 */
export interface SystemEntry {
  type: 'system'
  id: string
  subtype: string
  content?: string
  level?: string
  commands?: string[]
  writtenPaths?: string[]
  /** `task_notification` 行的最终状态。 */
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
  /** CLI 提议的 PermissionUpdate 对象（“始终允许……”）。 */
  suggestions: PermissionSuggestion[]
  /** 导致权限检查失败的路径（CLI 报告时才有）。 */
  blockedPath?: string
  /** CLI 的自由文本说明（目前 bridge 不转发）。 */
  decisionReason?: string
}

export interface ChatState {
  entries: ThreadEntry[]
  pendingPermissions: PendingPermission[]
  status: string | null
  closed: boolean
  lastSeqNum: number
  seenSeqNums: Set<number>
  /** 没有数值 `seqNum` 的事件改用 uuid 去重。 */
  seenEventIds: Set<string>
  /**
   * 已渲染过的 assistant 消息 uuid。bridge 每次入站重连都会把历史重放给
   * CLI，而 CLI 又回显 assistant 消息，因此同一条消息会在新的持久 seqNum 下
   * 再次到达。按消息 uuid 去重，避免重放导致 UI 重复文本。
   */
  seenAssistantUuids: Set<string>
  error: string | null
  /** 来自最新 `system/init` 的 bridge 安全斜杠命令（在收到前为空）。 */
  slashCommands: string[]
  /** 来自 `system/init` 的当前 CLI 权限模式；`null` 时隐藏模式控件。 */
  permissionMode: string | null
  /** 已发送但尚未被 CLI 确认的模式切换。 */
  pendingMode: { requestId: string; mode: WebPermissionMode } | null
  /** CLI 对最近一次模式切换的拒绝（例如 bypass 被禁用）。 */
  modeError: string | null
  /** 来自 `system/init` 的当前模型；`null` 表示 CLI 默认值（或尚未上报）。 */
  model: string | null
  /** 已发送但尚未被 CLI 确认的模型切换；`model` 为 `null` 表示重置为默认值。 */
  pendingModel: { requestId: string; model: string | null } | null
  /** CLI 对最近一次模型切换的拒绝。 */
  modelError: string | null
  /**
   * CLI 已确认的最近一次 Web 端请求的 thinking 状态；`null` 是 CLI 默认值
   * （或未知——`system/init` 不携带 thinking 状态）。
   */
  thinking: ThinkingState
  /** 已发送但尚未被 CLI 确认的 thinking 切换。 */
  pendingThinking: { requestId: string; choice: ThinkingChoice } | null
  /** CLI 对最近一次 thinking 切换的拒绝。 */
  thinkingError: string | null
  /**
   * 等待 control_response 的 `stop_task` 请求，按请求 id 映射到任务 id。
   * 回复本身就会关闭该行：被终止的任务可能不会发送 `task_notification`
   *（CLI 对 shell 会抑制它），而错误回复意味着该 id 下本就没有存活的任务。
   */
  pendingStops: Record<string, string>
  /** 运行中这一轮的实际开始时间，来自最新的用户消息。 */
  turnStartedAt: number | null
  /** 在一轮的首个事件与其 `result` 之间为 true；用于控制排队提示的显示。 */
  turnOpen: boolean
  /** 来自 `TodoWrite`（或上游 `task_state` 载荷）的最新任务列表。 */
  tasks: TaskItem[]
  /** CLI 仍在运行的后台任务（agents、workflows）。 */
  backgroundTasks: BackgroundTask[]
  /** 最近一条 assistant 消息的用量；在上报之前为 `null`。 */
  lastUsage: TokenUsage | null
}

/**
 * 持久历史行与实时 SSE 帧共享的形状。两者都携带 `seqNum`；只有历史在 `id`
 * 里携带事件 uuid。
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
  /** 仅实时帧（不带 `id:` 的 SSE）；不在持久序列之内。 */
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
// 载荷辅助函数
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * subagent 流量的父 Agent 工具调用 id。CLI 把 `parent_tool_use_id` 放在派生出的
 * assistant/user 消息顶层；gateway 的 `normalizePayload` 把原始内容保存在 `raw`
 * 下，因此两种形状都要读取。
 */
function parentToolUseIdOf(payload: Record<string, unknown>): string | undefined {
  const direct = asText(payload.parent_tool_use_id)
  if (direct) return direct
  const nested = asText(asRecord(payload.raw)?.parent_tool_use_id)
  return nested || undefined
}

/**
 * 历史行用服务器时间，实时帧用客户端接收时间：持久行携带 `createdAt`，
 * SSE 帧只有 `receivedAt`。
 */
function eventTimeOf(event: SessionEventInput): number | null {
  for (const value of [event.createdAt, event.receivedAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
}

/** 从 `content` / `message.content` 载荷中提取显示字符串。 */
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
// 状态归约器
// =============================================================================

/**
 * 流式快照是实时发布的，没有持久行，也不会被重放，
 * 因此它们必须完全绕过 seqNum/uuid 去重记账。
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

/** 每个线程的临时气泡 id；主线程沿用历史 id。 */
function streamingEntryId(parentToolUseId?: string): string {
  return parentToolUseId ? `${STREAMING_ENTRY_ID}:${parentToolUseId}` : STREAMING_ENTRY_ID
}

function isStreamingEntry(entry: ThreadEntry, parentToolUseId?: string): entry is AssistantMessageEntry {
  return entry.type === 'assistant_message' && entry.streaming === true && entry.parentToolUseId === parentToolUseId
}

/**
 * 移除某个线程的临时流式气泡（`undefined` = 主线程）；
 * 持久消息会取代它。各线程独立流式输出，因此持久化的 subagent 消息
 * 不得清除主线程的前缀。
 */
function dropThreadStreaming(state: ChatState, parentToolUseId?: string): ChatState {
  if (!state.entries.some((entry) => isStreamingEntry(entry, parentToolUseId))) return state
  return { ...state, entries: state.entries.filter((entry) => !isStreamingEntry(entry, parentToolUseId)) }
}

/** 本轮已结束或被中断：各线程的流式气泡都已过期。 */
function dropAllStreaming(state: ChatState): ChatState {
  if (!state.entries.some((entry) => entry.type === 'assistant_message' && entry.streaming)) return state
  return {
    ...state,
    entries: state.entries.filter((entry) => !(entry.type === 'assistant_message' && entry.streaming)),
  }
}

/**
 * 把一个增量追加到所属线程的临时气泡。线程在扁平 transcript 中交错，
 * 因此气泡按父指针而非位置定位——subagent 的增量绝不会并入主线程的文本。
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
  // 只续接同一线程的消息；subagent 的一轮绝不会追加到主线程气泡
  //（也不会追加到另一个 agent 的气泡）。
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

  // 重放的 assistant 消息带有它首次渲染时的 uuid。
  const messageUuid = asText(payload.uuid) || nextId
  if (messageUuid && state.seenAssistantUuids.has(messageUuid)) return state
  const seenAssistantUuids = new Set(state.seenAssistantUuids)
  seenAssistantUuids.add(messageUuid)

  // 持久消息会取代其自身线程的流式前缀；其他线程的气泡
  //（主线程 vs. subagent）继续流式输出。
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

/** 拼接 tool_result 内容中的文本块。 */
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
 * CLI 把工具结果报告为一个合成的 `user` 轮次，其内容是 `tool_result` 块列表
 * ——而不是独立的 `tool_result` 事件。把它们提取出来，让对应的工具卡片
 * 退出运行状态。
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
  // 显式命名但未匹配的工具调用保持不变。缺失/空的 id 按位置匹配，因此回退到
  // 同一线程中最近的运行中调用——subagent 调用在扁平 transcript 中交错。
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
 * 后台 shell（`local_bash`）的存活时间长于启动它的那一轮：CLI 只为
 * agents/workflows 保留 `result`，因此在轮次结束时清理必须保留它们，
 * 直到它们自己的 `task_notification` 到来。
 */
function retainPersistentTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  const kept = tasks.filter((task) => task.taskType === 'local_bash')
  return kept.length === tasks.length ? tasks : kept
}

/** 详细 transcript 渲染为行的信息性 system 子类型。 */
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
 * `system/init` 携带 bridge 安全的斜杠命令和当前权限模式；`system/status`
 * 在上报由 Web 未发起的变更后的实时模式（例如通过自动接受编辑来批准
 * ExitPlanMode）。SYSTEM_ROW_SUBTYPES 中的信息性子类型会变成 transcript 行；
 * 其余仍然被忽略。
 *
 * 重连会重新发送 init，因此后续消息只是替换先前的快照
 *（历史重放按序列顺序折叠）。
 */
function handleSystemEvent(state: ChatState, event: SessionEventInput): ChatState {
  const payload = asRecord(event.payload) ?? {}
  const subtype = asText(payload.subtype)

  if (subtype === 'status') {
    // status 不携带命令，因此只有模式会变化；无法识别的值
    //（例如仅 CLI 的 `auto`）会保留上次已知的模式。
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
    // 缺失/无效的 model 保留上次已知值；CLI 总会在 init 中发送它。
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

  // 后台任务生命周期。`task_started` 打开队列提示所依据的轮次窗口：
  // 这些任务运行期间 CLI 会保留 `result`。
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

  // `session_state_changed` 是 CLI 自身的存活声明。转入 idle 会结束轮次范围内的
  // 任务（agents/workflows 会保留 `result`，因此它们已经消失）；后台 shell 继续
  // 运行。轮次状态仍由 result/session_status 掌管。
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

  // 非权限的 control 请求共享同一个信封。`set_permission_mode` 和 `set_model`
  // 会作为出站事件被回显，因此它们同时充当各自切换的待处理跟踪器。
  const subtype = asText(request.subtype)
  if (subtype && subtype !== 'can_use_tool') {
    if (subtype === 'set_model') {
      return { ...state, pendingModel: { requestId, model: normalizeModel(request.model) }, modelError: null }
    }
    if (subtype === 'stop_task') {
      // 记住 Web 端要求停止的行：CLI 在这里用 control_response 回应，
      // 而不是 task_notification（子进程只为它终止的任务打点；已完成的任务
      // 会得到错误回复）。
      const taskId = asText(request.task_id)
      if (!taskId) return state
      return { ...state, pendingStops: { ...state.pendingStops, [requestId]: taskId } }
    }
    if (subtype === 'set_max_thinking_tokens') {
      // 回显的请求携带 Web 端发送的预算：null = 默认，0 = 关闭，>0 = 开启。
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

  // 已绑定到这一确切请求（重放的帧）：不再创建第二张卡片。
  const alreadyBound = state.entries.some(
    (entry) => entry.type === 'tool_call' && entry.toolCall.permissionRequest?.requestId === requestId,
  )
  if (alreadyBound) return { ...state, pendingPermissions }

  // 优先选择同一工具最近的运行中调用；回退到同一线程中最近的运行中调用
  //（subagent 调用在扁平 transcript 中交错）。已在等待确认的调用绝不会
  // 重新绑定到另一个请求。
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

/** CLI 的 control_response 把其结果嵌套在 `response` 下。 */
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

  // stop_task 的回复无论哪种结果都是权威的：成功表示 CLI 终止了该任务
  //（某些 CLI 版本对被终止的 shell 会抑制结束的 task_notification，若等待它
  // 会让该行永远挂着），错误表示它本就没有存活的任务。立即删除该行；
  // 迟到的通知是无操作，仍会追加它的 transcript 行。
  const stoppedTaskId = state.pendingStops[requestId]
  if (stoppedTaskId !== undefined) {
    const { [requestId]: _, ...pendingStops } = state.pendingStops
    return {
      ...state,
      pendingStops,
      backgroundTasks: completeBackgroundTask(state.backgroundTasks, stoppedTaskId),
    }
  }

  // 模式切换针对 pendingMode 结算，而不是针对权限卡片。
  const pendingMode = state.pendingMode
  if (pendingMode && pendingMode.requestId === requestId) {
    const outcome = responseOutcome(payload)
    if (outcome.subtype === 'error') {
      return { ...state, pendingMode: null, modeError: outcome.error || 'set_permission_mode failed' }
    }
    return { ...state, pendingMode: null, modeError: null, permissionMode: pendingMode.mode }
  }

  // 模型切换同理。成功回复不携带模型，因此采用请求的值；
  // 下一次 `system/init` 会纠正 CLI 规范化过的任何别名。
  const pendingModel = state.pendingModel
  if (pendingModel && pendingModel.requestId === requestId) {
    const outcome = responseOutcome(payload)
    if (outcome.subtype === 'error') {
      return { ...state, pendingModel: null, modelError: outcome.error || 'set_model failed' }
    }
    return { ...state, pendingModel: null, modelError: null, model: pendingModel.model }
  }

  // thinking 切换亦然。`default` 会清除已采用的状态；CLI 不会回显
  // 生效的预算，因此这里只记住 Web 端最后的选择。
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
    // 独立卡片背后没有工具调用，因此永远不会收到 `tool_result`；
    // 在此结算（批准 → complete，拒绝 → rejected）。
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
 * CLI 在本地（hook/classifier/recheck）决定了请求并取消它，而不是给出答复。
 * 移除匹配的卡片，使其不再阻塞 UI；已绑定的工具调用恢复为运行中，
 * 独立卡片则消失。
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
  // 本轮已停止（idle/archived/inactive）：任何在途流都已过期。
  const base = status === 'running' ? state : dropAllStreaming(state)
  // 上报的非运行状态会结束队列窗口，即使没有 result 事件到达
  //（崩溃或中断的轮次）。
  const turnOpen = status === 'running' || status === 'requires_action'
  const closed = isSessionClosedStatus(status)
  return { ...base, status, closed, turnOpen, backgroundTasks: closed ? [] : state.backgroundTasks }
}

/**
 * 在 `stream_event` 载荷中定位原始 SDK 流事件。
 *
 * 原始帧把它包在 `event` 下。gateway 的 `normalizePayload` 在发布前把每条
 * 入站消息存为 `{ content, raw }`，因此实时 SSE 流把 SDK 消息嵌套在 `raw`
 * 下，把事件嵌套在 `raw.event` 下。
 */
function streamEventOf(payload: Record<string, unknown>): Record<string, unknown> {
  const direct = asRecord(payload.event)
  if (direct) return direct
  const nested = asRecord(asRecord(payload.raw)?.event)
  if (nested) return nested
  return payload
}

/**
 * `stream_event` 载荷把原始 SDK 事件包在 `event` 下。增量按其线程
 *（`parent_tool_use_id`）归属：主线程文本流入普通气泡，而 subagent 文本
 * 在其自己的 Agent 卡片内流式输出。
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

  // 用实际时长结束运行中的一轮。当开始时间未知时丢弃标记
  //（例如早于第一页的历史）。
  let entries = base.entries

  // 本轮一结束，CLI 就会取出本轮期间排队的消息。
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
  // result 结束本轮；agents/workflows 已完成（它们保留 `result`），
  // 但后台 shell 可能仍在运行。
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
      // 两个方向都会渲染：gateway 把出站发送持久化为 `user` 事件，但不会
      // 作为入站回显，因此只把入站视为可显示，会在重新加载时丢失每条已发送的消息。
      const payload = asRecord(event.payload) ?? {}
      // 重放确认会回显历史已持有的消息。
      if (payload.isReplay === true) return state
      let entries = state.entries
      for (const result of collectUserToolResults(payload)) {
        entries = settleToolResult(entries, result)
      }
      // subagent 的 user 轮次携带它的工具结果（有时还有元文本）；它
      // 不是用户输入的提示，因此不生成气泡。
      if (parentToolUseIdOf(payload)) return entries === state.entries ? state : { ...state, entries }
      const text = extractEventText(event.payload)
      // 仅有图片的提示没有文本投影，但仍会渲染。
      const attachments = extractUserAttachments(event.payload)
      if (!text && attachments.length === 0) return entries === state.entries ? state : { ...state, entries }
      const seqNum = numericSeqNum(event)
      const id = asText(payload.uuid) || (seqNum !== null ? String(seqNum) : event.id || `user-${entries.length}`)
      // 按 uuid 去重：乐观发送及其历史/回显对应项即使在 seqNum 不同时
      // 也共享同一 uuid。
      if (entries.some((entry) => entry.type === 'user_message' && entry.id === id)) return { ...state, entries }
      const startedAt = eventTimeOf(event)
      // queued = CLI 正处于一轮之中。bridge 不总会发布
      // session_status，因此开放的轮次是可靠的信号。
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
        // 新的一轮从零开始；先前的失败不再描述它。
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
      // partial_assistant、automation_state、status 等有意忽略。
      // 后台任务生命周期搭载于 `system` 子类型之上。
      return state
  }
}

/** 把一行历史或一个实时帧折叠进聊天状态。 */
export function reduceSessionEvent(state: ChatState, event: SessionEventInput): ChatState {
  // 临时帧永远不会被重放，因此跳过持久去重集合。
  if (isEphemeralEvent(event)) return applyEvent(state, event)
  if (isDuplicate(state, event)) return state
  const seeded = markSeen(state, event)
  return applyEvent(seeded, event)
}

/** 会关闭当前流式 assistant 消息的持久事件类型。 */
const TERMINAL_STREAM_EVENT_TYPES = new Set([
  'assistant',
  'result',
  'result_success',
  'session_status',
  'interrupt',
  'error',
])

/**
 * 要在持久历史之上重放的实时增量窗口：最后一条终态持久事件之后到达的每个
 * 临时帧。喂入整个实时日志会在每次渲染时复活一个已完成的流式气泡。
 *
 * 窗口是按线程的：一条持久 assistant 消息只会退役它自己线程的前缀
 *（subagent 结束不得清空主流，反之亦然），而结束轮次的事件会关闭所有线程。
 */
export function activeStreamEvents(events: readonly SessionEventInput[]): SessionEventInput[] {
  let globalStart = 0
  const threadStarts = new Map<string, number>()

  // 第一遍：每个线程的最后一次切分（以及整体的最后一次结束轮次切分）。
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

  // 第二遍：通过了所有适用于其线程的切分的帧。
  return events.filter((candidate, i) => {
    if (!isEphemeralEvent(candidate)) return false
    const thread = parentToolUseIdOf(asRecord(candidate.payload) ?? {}) ?? ''
    return i >= globalStart && i >= (threadStarts.get(thread) ?? 0)
  })
}

/** 通过 reducer 折叠一页持久历史（从旧到新）。 */
export function applyHistory(state: ChatState, events: readonly SessionEventInput[]): ChatState {
  let next = state
  for (const event of events) next = reduceSessionEvent(next, event)
  return next
}
