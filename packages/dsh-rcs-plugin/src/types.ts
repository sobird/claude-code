import { isRecord } from '@sobird/dsh-bridge/core'

import type { UserMessageLike } from './message'

/** 只声明插件实际用到的 dsh 结构；主机不提供类型包，运行时由 dsh 保证。 */

/** 会话的最小引用；工作区挂载与标题服务只认这个活会话对象。 */
export type SessionRefLike = { readonly id: string }

export interface AgentLike {
  readonly id: string
  readonly session?: SessionRefLike
  followup(message: UserMessageLike): void
  cancel(cause: unknown, options?: { keepInbox?: boolean }): void
}

export interface AgentHandleLike {
  readonly agent: AgentLike
}

/** 类型别名（非 interface）才能满足翻译函数对 `Record<string, unknown>` 的隐式索引签名。 */
export type CreateAgentOptionsLike = {
  sessionId: string
  meta: { cwd: string }
  agentOptions: { provider: string; model: string }
}

export type ResumeAgentOptionsLike = {
  resumeSessionId: string
  agentOptions: { provider: string; model: string }
}

export interface AgentsServiceLike {
  get(id: string): AgentLike | undefined
  create(options: CreateAgentOptionsLike): Promise<AgentHandleLike>
  resume(options: ResumeAgentOptionsLike): Promise<AgentHandleLike>
}

export type SessionLike = { readonly id: string }
export type SessionEventLike = { type?: unknown; seq?: unknown; data?: unknown }
export type AgentStatusLike = { agent?: AgentLike; status?: unknown }

export type ApprovalRequestLike = {
  agent?: AgentLike
  toolName?: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

export type ApprovalOutcomeLike = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export type QuestionRequestLike = {
  agent?: AgentLike
  questions?: readonly Record<string, unknown>[]
  signal?: AbortSignal
}

export type QuestionAnswerLike = Record<string, unknown>

export interface PluginEvents {
  'session/event': (session: SessionLike, event: SessionEventLike) => void
  'agent/status': (event: AgentStatusLike) => void
  'approval/request': (
    request: ApprovalRequestLike,
    next: () => Promise<ApprovalOutcomeLike>,
  ) => Promise<ApprovalOutcomeLike>
  'user-questions/request': (
    request: QuestionRequestLike,
    next: () => Promise<QuestionAnswerLike>,
  ) => Promise<QuestionAnswerLike>
}

export type Disposer = () => void | Promise<void>

export interface PluginContextLike {
  readonly agents: AgentsServiceLike
  get(name: string): unknown
  on<E extends keyof PluginEvents>(event: E, listener: PluginEvents[E], options?: { prepend?: boolean }): unknown
  effect(effect: () => Disposer | Promise<Disposer>): unknown
}

/** profile 内的附件服务：把 base64 图片换成持久引用，文本原样通过。 */
export interface AttachmentsLike {
  admitPromptContent(content: readonly unknown[]): Promise<readonly unknown[]>
}

export function isAttachments(value: unknown): value is AttachmentsLike {
  return isRecord(value) && typeof value.admitPromptContent === 'function'
}

/** dsh 工作区：会话只有挂到工作区，侧边栏才会按工作区分组。 */
export interface WorkspaceLike {
  attachSession(sessionId: string): Promise<void>
}

/** 工作区注册表：`create` 对已注册目录直接复用，否则新建一条记录。 */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
}

export function isWorkspaceRegistry(value: unknown): value is WorkspaceRegistryLike {
  return isRecord(value) && typeof value.create === 'function'
}

/** 会话标题服务：把自动生成的标题换成显式标题。 */
export interface SessionTitleLike {
  rename(session: SessionRefLike, title: string): unknown
}

export function isSessionTitle(value: unknown): value is SessionTitleLike {
  return isRecord(value) && typeof value.rename === 'function'
}

/** 会话持久化服务：只需判断某个会话 id 是否已有落盘记录。 */
export interface SessionPersistenceLike {
  stat(id: string): Promise<{ header?: unknown } | undefined>
}

export function isSessionPersistence(value: unknown): value is SessionPersistenceLike {
  return isRecord(value) && typeof value.stat === 'function'
}
