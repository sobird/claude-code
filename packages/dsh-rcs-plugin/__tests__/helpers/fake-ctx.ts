import type { UserMessageLike } from '../../src/message'
import type {
  AgentLike,
  AgentStatusLike,
  AgentsServiceLike,
  ApprovalOutcomeLike,
  ApprovalRequestLike,
  AssistantStreamFrameLike,
  AssistantStreamPayloadLike,
  CreateAgentOptionsLike,
  Disposer,
  PluginContextLike,
  PluginEvents,
  QuestionAnswerLike,
  QuestionRequestLike,
  ResumeAgentOptionsLike,
  SessionEventLike,
  SessionLike,
  SessionRefLike,
  SessionTitleLike,
  WorkspaceLike,
  WorkspaceRegistryLike,
} from '../../src/types'

/** 只记录调用；turn/end 由测试显式 emit，模拟 agent 的正常收尾。 */
export class FakeAgent implements AgentLike {
  readonly id: string
  readonly session: SessionRefLike
  readonly followups: UserMessageLike[] = []
  readonly cancels: unknown[] = []

  constructor(id: string) {
    this.id = id
    this.session = { id }
  }

  followup(message: UserMessageLike): void {
    this.followups.push(message)
  }

  cancel(cause: unknown): void {
    this.cancels.push(cause)
  }
}

export class FakeAgents implements AgentsServiceLike {
  readonly live = new Map<string, FakeAgent>()
  readonly creates: CreateAgentOptionsLike[] = []
  readonly resumes: ResumeAgentOptionsLike[] = []

  get(id: string): AgentLike | undefined {
    return this.live.get(id)
  }

  async create(options: CreateAgentOptionsLike): Promise<{ agent: AgentLike }> {
    this.creates.push(options)
    const agent = new FakeAgent(options.sessionId)
    this.live.set(options.sessionId, agent)
    return { agent }
  }

  async resume(options: ResumeAgentOptionsLike): Promise<{ agent: AgentLike }> {
    this.resumes.push(options)
    const agent = new FakeAgent(options.resumeSessionId)
    this.live.set(options.resumeSessionId, agent)
    return { agent }
  }
}

/** 记录挂到本工作区的会话 id。 */
export class FakeWorkspace implements WorkspaceLike {
  readonly attachments: string[] = []
  readonly order: string[]

  constructor(order: string[]) {
    this.order = order
  }

  async attachSession(sessionId: string): Promise<void> {
    this.attachments.push(sessionId)
    this.order.push(`attach:${sessionId}`)
  }
}

/** 记录 `create` 收到的目录，并按注册顺序返回同一个工作区。 */
export class FakeWorkspaceRegistry implements WorkspaceRegistryLike {
  readonly creates: string[] = []
  readonly order: string[] = []
  readonly workspace = new FakeWorkspace(this.order)
  failure: Error | null = null

  async create(path: string, title?: string): Promise<WorkspaceLike> {
    if (this.failure) throw this.failure
    this.creates.push(path)
    this.order.push(`create:${path}`)
    void title
    return this.workspace
  }
}

/** 记录标题重命名调用。 */
export class FakeSessionTitle implements SessionTitleLike {
  readonly renames: { sessionId: string; title: string }[] = []

  rename(session: SessionRefLike, title: string): void {
    this.renames.push({ sessionId: session.id, title })
  }
}

/** 最小 Cordis 上下文：事件分桶、服务注入、effect 收集，外加测试用的派发入口。 */
export class FakeContext implements PluginContextLike {
  readonly agents = new FakeAgents()

  private readonly services = new Map<string, unknown>()
  private readonly disposers: Disposer[] = []
  private readonly sessionListeners: PluginEvents['session/event'][] = []
  private readonly statusListeners: PluginEvents['agent/status'][] = []
  private readonly streamListeners: PluginEvents['agent/assistant-stream'][] = []
  private readonly approvalListeners: PluginEvents['approval/request'][] = []
  private readonly questionListeners: PluginEvents['user-questions/request'][] = []

  provide(name: string, value: unknown): void {
    this.services.set(name, value)
  }

  get(name: string): unknown {
    return this.services.get(name)
  }

  on<E extends keyof PluginEvents>(event: E, listener: PluginEvents[E], options?: { prepend?: boolean }): unknown {
    // 测试接缝：泛型擦除后按事件名入桶，类型由各桶自己保证。
    if (event === 'session/event') this.add(this.sessionListeners, listener as PluginEvents['session/event'], options)
    else if (event === 'agent/status') this.add(this.statusListeners, listener as PluginEvents['agent/status'], options)
    else if (event === 'agent/assistant-stream') {
      this.add(this.streamListeners, listener as PluginEvents['agent/assistant-stream'], options)
    } else if (event === 'approval/request') {
      this.add(this.approvalListeners, listener as PluginEvents['approval/request'], options)
    } else if (event === 'user-questions/request') {
      this.add(this.questionListeners, listener as PluginEvents['user-questions/request'], options)
    } else {
      throw new Error(`fake ctx: unhandled event ${String(event)}`)
    }
    return undefined
  }

  effect(effect: () => Disposer | Promise<Disposer>): unknown {
    void Promise.resolve(effect()).then((disposer) => this.disposers.push(disposer))
    return undefined
  }

  get effectCount(): number {
    return this.disposers.length
  }

  /** 按注册顺序执行清理函数（模拟插件卸载）。 */
  async dispose(): Promise<void> {
    for (const disposer of this.disposers.splice(0)) await disposer()
  }

  emitSessionEvent(sessionId: string, event: SessionEventLike): void {
    const session: SessionLike = { id: sessionId }
    for (const listener of this.sessionListeners) listener(session, event)
  }

  emitAgentStatus(agentId: string, status: 'idle' | 'running'): void {
    const event: AgentStatusLike = { agent: this.agents.get(agentId), status }
    for (const listener of this.statusListeners) listener(event)
  }

  emitAssistantStream(agentId: string, frame: AssistantStreamFrameLike): void {
    const payload: AssistantStreamPayloadLike = { agent: this.agents.get(agentId), frame }
    for (const listener of this.streamListeners) listener(payload)
  }

  /** 从第一个监听器开始的 waterfall；没有监听器时落到终端实现。 */
  requestApproval(
    request: ApprovalRequestLike,
    terminal: () => Promise<ApprovalOutcomeLike>,
  ): Promise<ApprovalOutcomeLike> {
    let index = -1
    const next = (): Promise<ApprovalOutcomeLike> => {
      index += 1
      const listener = this.approvalListeners[index]
      return listener ? listener(request, next) : terminal()
    }
    return next()
  }

  requestQuestion(
    request: QuestionRequestLike,
    terminal: () => Promise<QuestionAnswerLike>,
  ): Promise<QuestionAnswerLike> {
    let index = -1
    const next = (): Promise<QuestionAnswerLike> => {
      index += 1
      const listener = this.questionListeners[index]
      return listener ? listener(request, next) : terminal()
    }
    return next()
  }

  private add<T>(list: T[], listener: T, options: { prepend?: boolean } | undefined): void {
    if (options?.prepend) list.unshift(listener)
    else list.push(listener)
  }
}
