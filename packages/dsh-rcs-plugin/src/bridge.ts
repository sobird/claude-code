import { randomUUID } from 'node:crypto'

import {
  RcsClient,
  RcsHttpError,
  approvalOutcome,
  approvalRequestEvent,
  asNumber,
  asText,
  errorMessage,
  isRecord,
  parseControlResponse,
  promptBlocks,
  questionRequestEvent,
  questionResult,
  translateSessionEvent,
  userMessageEvent,
  type ControlResolution,
  type DshPromptBlock,
  type RcsEvent,
  type RequiresActionDetails,
  type WorkerFrame,
  type WorkerSession,
  type WorkerStatus,
} from '@sobird/dsh-bridge/core'

import type { ResolvedConfig } from './config'
import { createUserMessage } from './message'
import {
  isAttachments,
  isSessionPersistence,
  isSessionQuery,
  isSessionTitle,
  isWorkspaceRegistry,
  type AgentLike,
  type AgentStatusLike,
  type ApprovalOutcomeLike,
  type ApprovalRequestLike,
  type AssistantStreamPayloadLike,
  type PluginContextLike,
  type QuestionAnswerLike,
  type QuestionRequestLike,
  type SessionEventLike,
  type SessionLike,
} from './types'

const HEARTBEAT_MS = 30_000
const RECONNECT_MS = 1_000
/** 插件自己创建的 RCS 会话 id 前缀；复用时只认这些，避免接管他人的 dsh 会话。 */
const SESSION_ID_PREFIX = 'cse_'
/** 增量合批间隔：RCS 的流式气泡是临时事件，太频繁只会放大 HTTP 次数。 */
const STREAM_FLUSH_MS = 80

/** 临时 `stream_event`；RCS reducer 从 `event` 下读 SDK 形状的流事件。 */
function streamEvent(event: Record<string, unknown>): RcsEvent {
  return { type: 'stream_event', payload: { type: 'stream_event', event } }
}

/** 挂起的人工请求；`settle(null)` 表示被取消（中断/停止/信号中止）。 */
type PendingHuman = (resolution: ControlResolution | null) => void

/** 桥生命周期钩子：`onGone` 在 RCS 返回 404（会话已删）时触发一次。 */
export interface BridgeHooks {
  onGone?: () => void
}

export interface PluginBridge {
  /** RCS 会话 id：上报、心跳与 SSE 都用它。 */
  readonly rcsSessionId: string
  /** dsh 侧会话 id：事件过滤与 agent 操作都用它。 */
  readonly agentSessionId: string
  /** `rcsSessionId` 的别名，保留给既有调用方。 */
  readonly sessionId: string
  /** 中止 pump/心跳、收尾挂起卡片并停止 agent。 */
  stop(): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(line: string): void {
  process.stderr.write(`[dsh-rcs-plugin] ${line}\n`)
}

/**
 * 一条 RCS 会话在 dsh 进程内的桥接：RCS 入站消息 → `agent.followup`，
 * 会话事件/审批/提问 → RCS。`rcsSessionId` 用于对上上报，`agentSessionId`
 * 是 dsh 侧身份；环境派发时两者相同，手动同步时 dsh 侧仍是本地会话 id。
 */
export class InProcessBridge implements PluginBridge {
  readonly rcsSessionId: string
  readonly agentSessionId: string
  readonly sessionId: string

  private readonly ctx: PluginContextLike
  private readonly config: ResolvedConfig
  private readonly rcs: RcsClient
  /** worker 凭据会过期：401 时用用户 key 重新握手换票，因此可变。 */
  private worker: WorkerSession
  private readonly hooks: BridgeHooks | undefined
  private goneNotified = false
  private refreshing: Promise<boolean> | null = null
  private readonly abort = new AbortController()
  private readonly pendingHuman = new Map<string, PendingHuman>()
  private readonly alwaysAllow = new Set<string>()
  /** 插件自己注入的 user 消息 id：它们来自 RCS，会话事件回发时跳过，避免重复。 */
  private readonly injectedUserIds = new Set<string>()

  private streamText = ''
  private streamThought = ''
  private streamTimer: ReturnType<typeof setTimeout> | null = null

  private agent: AgentLike | null = null
  private starting: Promise<AgentLike> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastSequence = 0
  private turnOpen = false
  private stopping = false
  /** 串行化上报，保证 dsh 事件到 RCS 的顺序与产生顺序一致。 */
  private posting: Promise<void> = Promise.resolve()

  constructor(
    ctx: PluginContextLike,
    config: ResolvedConfig,
    rcs: RcsClient,
    worker: WorkerSession,
    agentSessionId: string,
    hooks?: BridgeHooks,
  ) {
    this.ctx = ctx
    this.config = config
    this.rcs = rcs
    this.worker = worker
    this.hooks = hooks
    this.rcsSessionId = worker.sessionId
    this.agentSessionId = agentSessionId
    this.sessionId = worker.sessionId
  }

  async begin(): Promise<void> {
    this.ctx.on('session/event', this.onSessionEvent)
    this.ctx.on('agent/status', this.onAgentStatus)
    this.ctx.on('agent/assistant-stream', this.onAssistantStream)
    this.ctx.on('approval/request', this.onApproval, { prepend: true })
    this.ctx.on('user-questions/request', this.onQuestion, { prepend: true })
    await this.setStatus('idle')
    this.startHeartbeat()
    void this.pump()
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    await this.cancelPendingHuman('Interrupted')
    this.clearStreamBuffer()
    this.currentAgent()?.cancel({ kind: 'user' })
    await this.posting
    await this.setStatus('idle')
    this.abort.abort()
  }

  private onSessionEvent = (session: SessionLike, event: SessionEventLike): void => {
    if (session.id !== this.agentSessionId) return
    const type = asText(event.type)
    if (type === 'turn/start') this.turnOpen = true
    if (type === 'turn/end') this.turnOpen = false
    if (type === 'user/message') {
      this.forwardUserMessage(isRecord(event.data) ? event.data : {})
      return
    }
    // 最终 assistant 消息与结果都会先顶掉流式气泡，增量必须先入队。
    if (type === 'assistant/message' || type === 'turn/end') this.flushStream()
    const events = translateSessionEvent({
      type,
      seq: asNumber(event.seq),
      data: isRecord(event.data) ? event.data : {},
    })
    void this.post(events)
    if (type === 'turn/end' && this.pendingHuman.size === 0) void this.setStatus('idle')
  }

  /** dsh UI 里键入的提问同步回 RCS；插件自己注入的消息按 id 跳过。 */
  private forwardUserMessage(data: Record<string, unknown>): void {
    const id = asText(data.id)
    if (id && this.injectedUserIds.delete(id)) return
    const event = userMessageEvent(data)
    if (event) void this.post([event])
  }

  /** 把模型增量累积成 RCS 的临时 `stream_event`；最终消息到达前会先 flush。 */
  private onAssistantStream = (payload: AssistantStreamPayloadLike): void => {
    if (payload.agent?.id !== this.agentSessionId) return
    const type = asText(payload.frame?.type)
    if (type === 'start') {
      this.clearStreamBuffer()
      void this.post([streamEvent({ type: 'message_start' })])
      return
    }
    if (type === 'end') {
      this.flushStream()
      return
    }
    const chunk = isRecord(payload.frame?.chunk) ? payload.frame.chunk : null
    const chunkType = asText(chunk?.type)
    const text = asText(chunk?.text)
    if (!text) return
    if (chunkType === 'text-delta') this.streamText += text
    else if (chunkType === 'reasoning-delta') this.streamThought += text
    else return
    this.scheduleStreamFlush()
  }

  private scheduleStreamFlush(): void {
    if (this.streamTimer) return
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null
      this.flushStream()
    }, STREAM_FLUSH_MS)
    this.streamTimer.unref?.()
  }

  private flushStream(): void {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }
    const events: RcsEvent[] = []
    if (this.streamThought) {
      events.push(
        streamEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: this.streamThought } }),
      )
      this.streamThought = ''
    }
    if (this.streamText) {
      events.push(streamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: this.streamText } }))
      this.streamText = ''
    }
    if (events.length > 0) void this.post(events)
  }

  private clearStreamBuffer(): void {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }
    this.streamText = ''
    this.streamThought = ''
  }

  private onAgentStatus = (event: AgentStatusLike): void => {
    if (event.agent?.id !== this.agentSessionId) return
    if (this.pendingHuman.size > 0) return
    const status = asText(event.status)
    if (status === 'running') void this.setStatus('running')
    if (status === 'idle') void this.setStatus('idle')
  }

  private onApproval = async (
    request: ApprovalRequestLike,
    next: () => Promise<ApprovalOutcomeLike>,
  ): Promise<ApprovalOutcomeLike> => {
    if (request.agent?.id !== this.agentSessionId) return next()
    const toolName = asText(request.toolName) || 'unknown'
    // 「总是允许」只记在插件内存里：命中后直接放行，不再打扰 RCS。
    if (this.alwaysAllow.has(`${this.agentSessionId}:${toolName}`)) return 'allowed-once'

    const requestId = `perm_${randomUUID()}`
    const pending = this.awaitHuman(requestId, request.signal)
    await this.post([approvalRequestEvent(requestId, request)])
    await this.setStatus('requires_action', { toolName, description: asText(request.reason) })
    const resolution = await pending
    if (!resolution) return 'cancelled'
    if (resolution.approved) this.rememberAllowRules(resolution)
    return approvalOutcome(resolution)
  }

  private onQuestion = async (
    request: QuestionRequestLike,
    next: () => Promise<QuestionAnswerLike>,
  ): Promise<QuestionAnswerLike> => {
    if (request.agent?.id !== this.agentSessionId) return next()
    const questions = Array.isArray(request.questions) ? request.questions : []
    const first = isRecord(questions[0]) ? questions[0] : null
    const intent = isRecord(first?.intent) ? first.intent : null
    const toolName = intent?.kind === 'plan-review' ? 'ExitPlanMode' : 'AskUserQuestion'

    const requestId = `ask_${randomUUID()}`
    const pending = this.awaitHuman(requestId, request.signal)
    await this.post([questionRequestEvent(requestId, request)])
    await this.setStatus('requires_action', { toolName, description: asText(first?.question) })
    const resolution = await pending
    return resolution ? questionResult(request, resolution) : { cancelled: true }
  }

  private rememberAllowRules(resolution: ControlResolution): void {
    for (const rule of resolution.updatedPermissions) {
      if (rule.type !== 'addRules') continue
      if (asText(rule.behavior) !== 'allow') continue
      for (const item of Array.isArray(rule.rules) ? rule.rules : []) {
        if (!isRecord(item)) continue
        const toolName = asText(item.toolName)
        if (toolName) this.alwaysAllow.add(`${this.agentSessionId}:${toolName}`)
      }
    }
  }

  private awaitHuman(requestId: string, signal: AbortSignal | undefined): Promise<ControlResolution | null> {
    return new Promise((resolve) => {
      let detach: (() => void) | undefined
      const settle = (resolution: ControlResolution | null): void => {
        if (!this.pendingHuman.delete(requestId)) return
        detach?.()
        resolve(resolution)
      }
      this.pendingHuman.set(requestId, settle)
      if (signal) {
        const onAbort = (): void => settle(null)
        signal.addEventListener('abort', onAbort, { once: true })
        detach = () => signal.removeEventListener('abort', onAbort)
      }
    })
  }

  /** 待处理卡片统一收尾；同时补发 control_response，避免 UI 卡片卡住。 */
  private async cancelPendingHuman(message: string): Promise<void> {
    const pending = [...this.pendingHuman.entries()]
    if (pending.length === 0) return
    const events: RcsEvent[] = []
    for (const [requestId, settle] of pending) {
      settle(null)
      events.push({
        type: 'control_response',
        payload: {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'deny', message },
          },
        },
      })
    }
    await this.post(events)
  }

  private async pump(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        for await (const frame of this.rcs.streamEvents(this.worker, this.lastSequence, this.abort.signal)) {
          await this.handleFrame(frame)
        }
      } catch (error) {
        if (this.abort.signal.aborted) return
        // 流用 worker JWT 鉴权；过期时先换票再重连，避免每秒空转 401。
        if (error instanceof RcsHttpError && error.status === 401) {
          log(`worker stream: ${errorMessage(error)}; refreshing`)
          await this.refreshWorker()
        } else {
          log(`worker stream: ${errorMessage(error)}`)
        }
      }
      if (this.abort.signal.aborted) return
      await sleep(RECONNECT_MS)
    }
  }

  private async handleFrame(frame: WorkerFrame): Promise<void> {
    if (frame.sequenceNum !== null) this.lastSequence = Math.max(this.lastSequence, frame.sequenceNum)
    const payload = frame.payload
    const type = asText(payload.type) || frame.eventType

    if (type === 'user' || frame.eventType === 'user') {
      await this.handleUser(payload)
      return
    }
    if (type === 'control_response' || type === 'permission_response') {
      await this.handleControlResponse(payload)
      return
    }
    if (type === 'control_request') {
      const request = isRecord(payload.request) ? payload.request : null
      if (request?.subtype === 'interrupt') await this.interrupt()
      return
    }
    if (frame.eventType === 'interrupt') await this.interrupt()
  }

  private async handleUser(payload: Record<string, unknown>): Promise<void> {
    const blocks = promptBlocks(payload)
    if (blocks.length === 0) return
    try {
      const agent = await this.ensureAgent()
      this.turnOpen = true
      await this.setStatus('running')
      const message = createUserMessage(await this.admit(blocks))
      this.injectedUserIds.add(message.id)
      agent.followup(message)
    } catch (error) {
      this.turnOpen = false
      await this.postResultError(errorMessage(error))
      await this.setStatus('idle')
    }
  }

  /** 图片需要附件服务换成持久引用；纯文本直接通过。 */
  private async admit(blocks: readonly DshPromptBlock[]): Promise<readonly unknown[]> {
    if (!blocks.some((block) => block.type === 'image')) return blocks
    const attachments = this.ctx.get('attachments')
    if (!isAttachments(attachments)) {
      throw new Error('image prompts require the attachments service in this dsh profile')
    }
    return attachments.admitPromptContent(blocks)
  }

  private async handleControlResponse(payload: Record<string, unknown>): Promise<void> {
    const response = isRecord(payload.response) ? payload.response : null
    const requestId = asText(response?.request_id) || asText(payload.request_id)
    const resolution = parseControlResponse(payload)
    if (!requestId || !resolution) return
    const pending = this.pendingHuman.get(requestId)
    if (!pending) return
    pending(resolution)
    if (this.pendingHuman.size === 0) await this.setStatus('running')
  }

  /** 停止当前轮：给挂起卡片补应答，再取消 agent；aborted result 由 turn/end 产生。 */
  private async interrupt(): Promise<void> {
    await this.cancelPendingHuman('Interrupted')
    this.clearStreamBuffer()
    this.currentAgent()?.cancel({ kind: 'user' })
  }

  /** 优先用已创建的 agent；插件启动时不建 agent，停止/中断时要回落到服务里查。 */
  private currentAgent(): AgentLike | null {
    const agent = this.agent ?? this.ctx.agents.get(this.agentSessionId) ?? null
    if (agent) this.agent = agent
    return agent
  }

  private ensureAgent(): Promise<AgentLike> {
    const existing = this.ctx.agents.get(this.agentSessionId)
    if (existing) {
      this.agent = existing
      return Promise.resolve(existing)
    }
    this.starting ??= this.createAgent().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async createAgent(): Promise<AgentLike> {
    const agentOptions = { provider: this.config.provider, model: this.config.model }
    // 会话 id 就是身份：有落盘记录就恢复（重启复用），否则新建。
    const persistence = this.ctx.get('sessionPersistence')
    if (isSessionPersistence(persistence) && (await persistence.stat(this.agentSessionId))) {
      const handle = await this.ctx.agents.resume({ resumeSessionId: this.agentSessionId, agentOptions })
      this.agent = handle.agent
      await this.registerSession(handle.agent)
      return handle.agent
    }
    const handle = await this.ctx.agents.create({
      sessionId: this.agentSessionId,
      meta: { cwd: this.config.workdir },
      agentOptions,
    })
    this.agent = handle.agent
    await this.registerSession(handle.agent)
    return handle.agent
  }

  /**
   * 把新建/恢复的会话挂到 `workdir` 对应的工作区，并按需同步 RCS 标题。
   * 不挂工作区的会话只会落在 dsh 侧边栏的「未分组」；这里失败只记日志，不影响桥接。
   */
  private async registerSession(agent: AgentLike): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (isWorkspaceRegistry(registry)) {
      try {
        const workspace = await registry.create(this.config.workdir)
        await workspace.attachSession(this.agentSessionId)
      } catch (error) {
        log(`workspace attach: ${errorMessage(error)}`)
      }
    }

    const sessionTitle = this.ctx.get('sessionTitle')
    const title = this.config.sessionTitle
    if (title && agent.session !== undefined && isSessionTitle(sessionTitle)) {
      try {
        sessionTitle.rename(agent.session, title)
      } catch (error) {
        log(`session title: ${errorMessage(error)}`)
      }
    }
  }

  /** worker 请求的统一换票：401 时重新握手并重试一次；并发请求共用同一次刷新。 */
  private async withWorker<T>(action: (worker: WorkerSession) => Promise<T>): Promise<T> {
    try {
      return await action(this.worker)
    } catch (error) {
      if (!(error instanceof RcsHttpError) || error.status !== 401) throw error
      if (!(await this.refreshWorker())) throw error
      return action(this.worker)
    }
  }

  /** 用用户 key 重新换 worker JWT；失败只记日志，等待下次请求再试。 */
  private refreshWorker(): Promise<boolean> {
    this.refreshing ??= this.rcs
      .openWorker(this.rcsSessionId)
      .then((worker) => {
        this.worker = worker
        log(`worker token refreshed for ${this.rcsSessionId}`)
        return true
      })
      .catch((error: unknown) => {
        log(`worker refresh: ${errorMessage(error)}`)
        return false
      })
      .finally(() => {
        this.refreshing = null
      })
    return this.refreshing
  }

  private startHeartbeat(): void {
    const beat = (): void => {
      void this.withWorker((worker) => this.rcs.heartbeat(worker)).catch((error: unknown) => {
        log(`heartbeat: ${errorMessage(error)}`)
      })
    }
    beat()
    this.heartbeat = setInterval(beat, HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  private post(events: readonly RcsEvent[]): Promise<void> {
    if (events.length === 0) return this.posting
    const payloads = events.map((event) => ({ type: event.type, ...event.payload }))
    this.posting = this.posting.then(async () => {
      try {
        await this.withWorker((worker) => this.rcs.postEvents(worker, payloads))
      } catch (error) {
        this.notifyGone(error)
        log(`post events: ${errorMessage(error)}`)
      }
    })
    return this.posting
  }

  private async postResultError(message: string): Promise<void> {
    await this.post([
      {
        type: 'result',
        payload: {
          type: 'result',
          subtype: 'error',
          uuid: `dsh-error-${randomUUID()}`,
          is_error: true,
          result: message,
        },
      },
    ])
  }

  private async setStatus(status: WorkerStatus, details?: RequiresActionDetails): Promise<void> {
    try {
      await this.withWorker((worker) => this.rcs.setWorkerStatus(worker, status, details))
    } catch (error) {
      this.notifyGone(error)
      log(`status ${status}: ${errorMessage(error)}`)
    }
  }

  /** 404 表示 RCS 已删除该会话；只通知一次，避免 stop 时的收尾请求反复触发。 */
  private notifyGone(error: unknown): void {
    if (this.goneNotified) return
    if (!(error instanceof RcsHttpError) || error.status !== 404) return
    this.goneNotified = true
    this.hooks?.onGone?.()
  }
}

/**
 * 挑一条可复用的桥接会话：与 dsh Web UI 同源的 `sessionQuery` 列表里，取最近的
 * `cse_` 会话（优先工作目录一致）。列表或探测失败都回落到新建。
 */
async function findReusableSession(ctx: PluginContextLike, workdir: string): Promise<string | undefined> {
  const query = ctx.get('sessionQuery')
  if (!isSessionQuery(query)) {
    log('sessionQuery unavailable: starting a fresh session')
    return undefined
  }
  try {
    const records = await query.listSessions()
    const candidates = records.filter((record) => {
      const id = asText(record.header?.id)
      return id.startsWith(SESSION_ID_PREFIX)
    })
    log(`session list: ${records.length} record(s), ${candidates.length} reusable candidate(s)`)
    const preferred = candidates.find((record) => asText(record.header?.cwd) === workdir) ?? candidates[0]
    return preferred ? asText(preferred.header?.id) || undefined : undefined
  } catch (error) {
    log(`session list: ${errorMessage(error)}`)
    return undefined
  }
}

/** 建 RCS 会话（复用已落盘的身份，或新开一条）、换 worker 凭据并开始桥接。 */
export async function startPluginBridge(ctx: PluginContextLike, config: ResolvedConfig): Promise<PluginBridge> {
  const rcs = new RcsClient({ baseUrl: config.rcsBaseUrl, apiKey: config.apiKey })
  let sessionId = config.sessionId
  let worker: WorkerSession | undefined
  let origin: 'configured' | 'reused' | 'created' = 'configured'
  if (!sessionId) {
    origin = 'created'
    const reusable = await findReusableSession(ctx, config.workdir)
    if (reusable) {
      try {
        worker = await rcs.openWorker(reusable)
        sessionId = reusable
        origin = 'reused'
      } catch (error) {
        log(`reuse ${reusable}: ${errorMessage(error)}`)
      }
    }
  }
  sessionId ??= await rcs.createSession(config.sessionTitle)
  worker ??= await rcs.openWorker(sessionId)
  log(`attached to ${config.rcsBaseUrl} session ${sessionId} (${origin})`)
  const bridge = new InProcessBridge(ctx, config, rcs, worker, worker.sessionId)
  await bridge.begin()
  return bridge
}
