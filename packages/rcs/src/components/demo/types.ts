/**
 * View models shared by the demo console's mock data and its live adapter.
 *
 * `DemoConsole` renders one visual model; `?source=mock` fills it from the
 * hand-written study below, while the default live mode maps real gateway
 * sessions/messages onto the same shapes (`useLiveConsole`).
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
      /** Present in live mode: the gateway request id to answer. */
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

/** A fleet row: a console session plus which environment it lives on (null = unassigned). */
export interface FleetSession extends DemoSession {
  id: string
  environmentId: string | null
}

/** The active session in live mode carries a little state the rail rows do not. */
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
