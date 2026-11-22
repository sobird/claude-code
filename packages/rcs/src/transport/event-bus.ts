/**
 * 进程内的会话事件总线。
 *
 * 这里只做发布/订阅的扇出：总线不保留历史，也不做持久化重放。持久化由调用方
 * 通过 `repos.events.append` 负责；Task 11 会为本模块补上消费它的
 * WebSocket/SSE 传输层。
 */

import type { SessionEventRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { sanitizeTaskUsage } from '@/lib/background-tasks'
import { notifyInboundEvent } from '@/services/push-notifier'

export interface SessionEvent {
  /** 事件 UUID（`session_events.event_id`）。 */
  id: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  /**
   * 序列号。持久化事件使用 `session_events.id` 的 bigserial（SSE 游标）；
   * 仅实时事件使用保留的内存区间，永远不会推进它。
   */
  seqNum: number
  /** Epoch milliseconds. */
  createdAt: number
  /**
   * 仅实时事件（流式增量）：投递给已连接的订阅者，从不持久化、从不重放。
   * 它的帧不带 SSE `id:`，因此永远不会成为 `Last-Event-ID` 游标。
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
        // 失败的订阅者不能打断发布者；丢弃该错误。
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
 * 为 ACP channel group 保留历史的事件总线（R25）。
 *
 * 不同于会话 `EventBus`（仅扇出；持久化落在 `session_events`），ACP channel-group
 * 的流量留在内存里：重写前的总线保留了尾部，使重连的 SSE 消费者能经由
 * `Last-Event-ID` 重放近期事件。原样照搬该行为：最多保留 `MAX_ACP_EVENTS_PER_BUS`
 * 个事件，超出时淘汰最旧的一半。
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
        // 失败的订阅者不能打断发布者；丢弃该错误。
      }
    }
    return full
  }

  getLastSeqNum(): number {
    return this.seqNum
  }

  /** 保留的事件中 `seqNum > seqNum` 的部分，最早的在前。 */
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
 * ACP channel-group 总线的命名空间化 key。`channel_group_id` 是客户端提供的，
 * 只在单个 owner 的环境内有意义，因此总线也按 owner 作 key——否则两个 owner
 * 选了相同 id 时会共用一个事件总线。
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

/** 测试/关闭辅助：所有活跃的 ACP channel-group 总线。 */
export function getAllAcpEventBuses(): Map<string, AcpEventBus> {
  return acpBuses
}

/**
 * 从 bridge 发出的各种消息载荷形状中提取纯文本：
 * `{ content: "text" }`、`{ message: { content: "text" } }`，以及
 * `{ message: { content: [{ type: 'text', text: '…' }] } }`。
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
 * 把事件载荷规范化为带保证的 `content` 字符串的扁平结构。原始载荷保留在
 * `raw` 中；工具与权限相关的字段会被复制过去。
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
  // subagent 流量指向它的 Agent 工具调用；Web 端 reducer 据此嵌套。
  if (typeof p.parent_tool_use_id === 'string') normalized.parent_tool_use_id = p.parent_tool_use_id
  if (typeof p.status === 'string') normalized.status = p.status
  if (typeof p.subtype === 'string') normalized.subtype = p.subtype

  if (p.tool_name) normalized.tool_name = p.tool_name
  if (p.name) normalized.tool_name = p.name
  if (p.tool_input) normalized.tool_input = p.tool_input
  if (p.input) normalized.tool_input = p.input

  if (p.request_id) normalized.request_id = p.request_id
  if (p.request) normalized.request = p.request
  // `control_response` 把关联 id 和结果放在 `response` 里；
  // Web 端 reducer 据此结算待处理的 control 请求（如 set_permission_mode），
  // 因此它既要留在 `raw` 里，也要提到顶层。
  if (p.response) normalized.response = p.response
  if (p.approved !== undefined) normalized.approved = p.approved
  if (p.updated_input) normalized.updated_input = p.updated_input
  if (p.updated_permissions !== undefined) normalized.updated_permissions = p.updated_permissions

  if (p.message) normalized.message = p.message

  // `system/init` 驱动 Web 端的斜杠命令菜单和权限模式控件，
  // 因此把它的扁平字段从 `raw` 中提到客户端查找它们的位置。详细
  // transcript 字段（压缩级别、重试命令、已写入路径）也以同样方式带出。
  if (type === 'system') {
    if (Array.isArray(p.slash_commands)) normalized.slash_commands = p.slash_commands
    if (typeof p.permissionMode === 'string') normalized.permissionMode = p.permissionMode
    if (typeof p.model === 'string') normalized.model = p.model
    if (typeof p.fast_mode_state === 'string') normalized.fast_mode_state = p.fast_mode_state
    if (typeof p.level === 'string') normalized.level = p.level
    if (Array.isArray(p.commands)) {
      normalized.commands = p.commands.filter((item) => typeof item === 'string')
    }
    if (Array.isArray(p.writtenPaths)) {
      normalized.writtenPaths = p.writtenPaths.filter((item) => typeof item === 'string')
    }
    // 后台任务生命周期字段。`status` 已在上面为所有类型提到顶层；
    // 这里是与任务相关的字段，由 reducer 折叠进 ChatState。
    if (typeof p.task_id === 'string') normalized.task_id = p.task_id
    if (typeof p.tool_use_id === 'string') normalized.tool_use_id = p.tool_use_id
    if (typeof p.description === 'string') normalized.description = p.description
    if (typeof p.task_type === 'string') normalized.task_type = p.task_type
    if (typeof p.summary === 'string') normalized.summary = p.summary
    if (typeof p.last_tool_name === 'string') normalized.last_tool_name = p.last_tool_name
    if (typeof p.state === 'string') normalized.state = p.state
    const usage = sanitizeTaskUsage(p.usage)
    if (usage) normalized.usage = usage
  }

  if (type === 'task_state') {
    if (typeof p.task_list_id === 'string') normalized.task_list_id = p.task_list_id
    if (typeof p.taskListId === 'string') normalized.taskListId = p.taskListId
    if (Array.isArray(p.tasks)) normalized.tasks = p.tasks
  }

  return normalized
}

/**
 * `uuid` 唯一标识整条消息的事件类型，因此重复的 uuid 说明这是一条已经持久化
 * 的消息的重放。流式增量（`stream_event`、`partial_assistant`）与最终消息共享
 * uuid，但属于不同事件，绝不能去重。
 */
const UUID_IDENTIFIED_EVENT_TYPES = new Set(['user', 'assistant', 'system', 'result', 'result_success'])

/** 从已规范化的载荷中提取 `type` 的去重 key。 */
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
 * 持久化一个会话事件（写穿到 `session_events`）并发布到给定的总线。
 * 返回发布的事件；它的 `seqNum` 就是持久化行的 id。
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
 * 天生只实时的事件类型：消息流式输出时，bridge 大约每 100ms 重新发送一次
 * 截至目前的全量快照。没有任何消费者会重放它们（Web reducer 忽略它们；
 * bridge 与 worker 流只重放出站），因此持久化它们只会让 `session_events`
 * 增长，并在 `raw` 下把载荷翻倍。
 */
const EPHEMERAL_EVENT_TYPES = new Set(['stream_event', 'partial_assistant'])

/**
 * 临时事件没有持久化行，但 SSE 消费者仍需要一个唯一的数值 `seqNum` 用于
 * 每连接去重。从一个保留的高位区间分配，持久化 bigserial id 实际不会触及它；
 * 帧省略 `id:`，所以这个值永远不会变成续传游标。
 */
const EPHEMERAL_SEQ_BASE = Number.MAX_SAFE_INTEGER - 2 ** 32
let ephemeralSeqNum = EPHEMERAL_SEQ_BASE

export interface PublishInboundOptions {
  /** 客户端把流快照标记为 `ephemeral: true`；仅实时发布、不持久化。 */
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
 * 持久化一个入站 bridge 事件（除非该会话已存在同 uuid 的整条消息事件），
 * 然后发布它。
 *
 * bridge 每次重连都会把历史重放给子进程；子进程注入并回显这些消息，
 * 并以 `isReplay: true` 确认重复的用户提示。持久化每一次回显会让下一次
 * 重放窗口变大，于是循环不断累积，直到模型 API 因重复的 `tool_use` 块而
 * 报错。传输契约明确要求服务端按 UUID 对 bridge 写入去重
 * （WebSocketTransport 的重连重放），所以这是服务端的责任。
 *
 * 临时事件（显式标志或流式增量类型）完全跳过持久化，仅实时投递。
 *
 * 事件因重复被丢弃时返回 `null`。
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
  // 常见顺序重放的廉价提前退出；这次读取不是权威判断。
  if (messageUuid && (await repos.events.hasMessageUuid(sessionId, messageUuid))) return null
  // 持久化 key 才是真正的守卫：两个并发写入者可能都通过上面的检查。
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
  notifyInboundEvent(sessionId, type, normalized)
  return event
}

/** 把持久化的 `session_events` 行映射为进程内事件形状。 */
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
 * 按 `seqNum` 升序加载一个持久化重放窗口。
 *
 * 真正的游标会重放它之后的最旧事件（受 `limit` 限制）。没有游标时就没有
 * 可续传的起点，因此重放最新的 `limit` 个事件：重写前的内存总线保留尾部
 * （淘汰最旧），而从 0 重放会静默丢掉长会话连接前最近的历史。在 `latestId`
 * 解析之后追加的事件由调用方的订阅实时投递。
 */
export async function loadEventReplayWindow(
  repos: Repositories,
  sessionId: string,
  cursor: number,
  limit: number,
  direction?: SessionEventRecord['direction'],
): Promise<SessionEvent[]> {
  // `direction` 在查询内部应用，因此 limit 统计的是可重放行，
  // 而不是被另一方向的积压消耗掉。
  if (cursor > 0) {
    return (await repos.events.listSince(sessionId, cursor, limit, direction)).map(toSessionEvent)
  }

  const latest = await repos.events.latestId(sessionId)
  if (latest === null) return []
  return (await repos.events.listBefore(sessionId, latest + 1, limit, direction)).map(toSessionEvent)
}

export interface ReplayThenLiveOptions {
  bus: EventBus
  /** 游标：重放 `seqNum > fromSeqNum` 的事件。 */
  fromSeqNum: number
  /**
   * 加载持久化重放窗口。在实时订阅激活后调用一次。
   * 除非 `replay` 为 true，否则忽略。
   */
  loadSince: () => Promise<SessionEvent[]>
  /** 按 `seqNum` 升序发出重放事件。 */
  onReplayEvent: (event: SessionEvent) => void
  /** 发出实时事件，包括重放查询期间缓冲的那些。 */
  onLiveEvent: (event: SessionEvent) => void
  /** 即使 `fromSeqNum` 为 0 也强制重放；WebSocket 与 SSE 两条路径都会设置它。 */
  replay?: boolean
  /** 仅实时过滤器；重放事件由 `loadSince` 过滤。 */
  filterLiveEvent?: (event: SessionEvent) => boolean
  /** 消费者一旦消失即为 true；停止发出并取消订阅。 */
  isClosed?: () => boolean
}

export interface ReplayThenLiveSubscription {
  /** 在重放发出、缓冲的实时事件冲刷完毕后 resolve。 */
  ready: Promise<void>
  /** 解除实时订阅并丢弃任何缓冲的事件。 */
  unsubscribe: () => void
}

/**
 * 先订阅会话总线再读取持久化历史，然后先发出重放、再发出实时事件。
 *
 * 这弥补了「先持久化后发布」的竞态（R22）：否则在「读取历史」与「订阅」之间
 * 追加的事件会丢失，而在读取历史之前追加、却在读取期间发布的事件会重复。
 * 重放查询进行期间收到的实时事件会被缓冲；重放之后，只有当它们的 `seqNum`
 * 超过最后重放的 `seqNum` 时才冲刷，从而在不丢失内容的前提下对
 * 重放/实时的边界去重。
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
      // 对重放/实时的边界去重：已被重放覆盖的都被丢弃。
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
