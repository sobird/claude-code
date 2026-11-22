/**
 * 演示控制台的 mock 数据与实时适配器共用的视图模型。
 *
 * `DemoConsole` 只渲染一套视觉模型；`?source=mock` 用下方手写的设计研究填充它，
 * 而默认的实时模式通过 `useLiveConsole` 把真实的网关会话/消息映射到相同的形状上。
 */

export type SessionStatus = 'running' | 'active' | 'idle'
export type ToolState = 'done' | 'running' | 'error'

export interface ToolLine {
  name: string
  detail: string
  time: string
  state: ToolState
}

export type Entry =
  | { kind: 'system'; text: string }
  | { kind: 'user'; text: string; at: string }
  | { kind: 'assistant'; paragraphs: string[] }
  | { kind: 'tools'; items: ToolLine[] }
  | {
      kind: 'permission'
      title: string
      detail: string
      command: string
      /** 实时模式下存在：需要回应的网关请求 id。 */
      requestId?: string
    }

export interface DemoTask {
  label: string
  done: boolean
  active?: boolean
}

export interface DemoSession {
  title: string
  status: SessionStatus
  updated: string
  branch: string
  elapsed: string
  tokens: number
  limit: number
  entries: Entry[]
  tasks: DemoTask[]
}

export interface DemoEnvironment {
  id: string
  name: string
  host: string
  status: 'online' | 'idle' | 'offline'
}

/** 一条环境列表行：一个控制台会话，以及它所在的环境（null = 未分配）。 */
export interface FleetSession extends DemoSession {
  id: string
  environmentId: string | null
}

/** 实时模式下的活动会话，带有一些列表行没有的状态。 */
export interface ActiveSession extends FleetSession {
  closed: boolean
  streaming: boolean
  turnOpen: boolean
}

export type Turn = { role: 'user'; text: string } | { role: 'assistant'; text: string }

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: '运行中',
  active: '进行中',
  idle: '空闲',
}
