/**
 * Gateway data shapes consumed by the dashboard shell.
 *
 * Mirrors the JSON returned by `GET /web/sessions/all` and
 * `GET /web/environments` (see the gateway route handlers). Timestamps are
 * epoch seconds; `owner_user_id` is `null` for unclaimed rows.
 */

/** CLI 阻塞在哪个交互上；`kind` 决定列表徽标的文案。 */
export interface AwaitingState {
  kind: 'permission' | 'question' | 'plan'
  tool_name: string | null
  description: string | null
}

export interface SessionSummary {
  id: string
  title: string | null
  status: string
  environment_id: string | null
  owner_user_id: string | null
  updated_at: number
  /** 最近一次轮次结束的事件 seq；未读判定以此为准。 */
  last_result_seq?: number | null
  /** 最近一次结束的轮次是否失败。 */
  last_result_failed?: boolean
  /** `requires_action` 的结构化原因；其他状态为 null。 */
  awaiting?: AwaitingState | null
  /** 账号级未读：你上次确认之后又有轮次结束。 */
  unread?: boolean
}

export interface EnvironmentSummary {
  id: string
  machine_name: string | null
  directory: string | null
  branch: string | null
  status: string
  owner_user_id: string | null
  last_poll_at: number | null
  worker_type: string
  channel_group_id: string | null
  capabilities: Record<string, unknown> | null
}

/** Session shape returned by `POST /web/sessions`. */
export interface CreatedSession {
  id: string
  title: string | null
  status: string
  environment_id: string | null
  owner_user_id: string | null
  updated_at: number
}

export interface DashboardUser {
  id: string
  name: string
  role: string
}

interface OwnedSession extends SessionSummary {
  owner: string | null
}

interface OwnedEnvironment extends EnvironmentSummary {
  owner: string | null
}

/** Map gateway rows onto the `{ owner }` shape the selectors consume. */
export function toOwnedSessions(sessions: readonly SessionSummary[]): OwnedSession[] {
  return sessions.map((session) => ({ ...session, owner: session.owner_user_id }))
}

export function toOwnedEnvironments(environments: readonly EnvironmentSummary[]): OwnedEnvironment[] {
  return environments.map((environment) => ({ ...environment, owner: environment.owner_user_id }))
}
