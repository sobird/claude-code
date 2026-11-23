/**
 * Task 工具族正文：按规范工具名分派创建、更新、清单与详情。
 *
 * 输入来自 `rawInput`，状态流转与 id 只能从结果文本里读（CLI 的结果形状见
 * `src/tools/Task*Tool/*.ts` 的 `mapToolResultToToolResultBlockParam`）。
 * 解析不出内容时返回 `null`，由调用方退回通用正文。
 */

import type { ToolCallData } from '@/lib/session-reducer'
import { canonicalToolName } from '@/lib/tool-summary'

import { formatOutput } from './format'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskListRow {
  id: string
  subject: string
  status: TaskStatus | null
  owner: string | null
  blockedBy: string[]
}

export interface TaskDetail {
  id: string
  subject: string
  status: TaskStatus | null
  description: string | null
  blocks: string[]
  blockedBy: string[]
}

export type TaskViewModel =
  | { kind: 'create'; subject: string; description: string | null; activeForm: string | null; taskId: string | null }
  | {
      kind: 'update'
      taskId: string
      fields: string[]
      status: TaskStatus | 'deleted' | null
      owner: string | null
      blocks: string[]
      blockedBy: string[]
      notFound: boolean
    }
  | { kind: 'list'; tasks: TaskListRow[]; empty: boolean }
  | { kind: 'get'; task: TaskDetail | null }

const CREATED_ID = /^Task #(\S+) created successfully/m
const UPDATED_FIELDS = /^Updated task #\S+ (.+)$/m
const NOT_FOUND = /^Task #\S+ not found$/m
const LIST_LINE = /^#(\S+) \[([^\]]+)\] (.*)$/
const LIST_BLOCKED = /^(.*) \[blocked by (.+)\]$/
const LIST_OWNER = /^(.*) \(([^()]*)\)$/

export function taskViewModel(tool: ToolCallData): TaskViewModel | null {
  const input = tool.rawInput ?? {}
  const output = formatOutput(tool).trim()
  switch (canonicalToolName(tool.title)) {
    case 'TaskCreate':
      return createModel(input, output)
    case 'TaskUpdate':
      return updateModel(input, output)
    case 'TaskList':
      return output ? listModel(output) : null
    case 'TaskGet':
      return output ? getModel(output) : null
    default:
      return null
  }
}

function createModel(input: Record<string, unknown>, output: string): TaskViewModel | null {
  const subject = text(input.subject)
  if (!subject) return null
  return {
    kind: 'create',
    subject,
    description: text(input.description),
    activeForm: text(input.activeForm),
    taskId: output.match(CREATED_ID)?.[1] ?? null,
  }
}

function updateModel(input: Record<string, unknown>, output: string): TaskViewModel | null {
  const taskId = text(input.taskId)
  if (!taskId) return null
  const line = output.match(UPDATED_FIELDS)?.[1]
  return {
    kind: 'update',
    taskId,
    fields: line
      ? line
          .split(',')
          .map((field) => field.trim())
          .filter(Boolean)
      : [],
    status: statusOf(input.status),
    owner: text(input.owner),
    blocks: strings(input.addBlocks),
    blockedBy: strings(input.addBlockedBy),
    notFound: NOT_FOUND.test(output),
  }
}

function listModel(output: string): TaskViewModel {
  if (output === 'No tasks found') return { kind: 'list', tasks: [], empty: true }
  const tasks = output
    .split('\n')
    .map(parseListLine)
    .filter((row): row is TaskListRow => row !== null && row.id !== '')
  return { kind: 'list', tasks, empty: tasks.length === 0 }
}

function parseListLine(line: string): TaskListRow | null {
  const match = line.match(LIST_LINE)
  if (!match) return null
  let subject = match[3] ?? ''
  let owner: string | null = null
  let blockedBy: string[] = []
  const blocked = subject.match(LIST_BLOCKED)
  if (blocked) {
    subject = blocked[1] ?? ''
    blockedBy = hashIds(blocked[2] ?? '')
  }
  const owned = subject.match(LIST_OWNER)
  if (owned) {
    subject = owned[1] ?? ''
    owner = owned[2] || null
  }
  return { id: match[1] ?? '', subject, status: taskStatusOf(match[2]), owner, blockedBy }
}

function getModel(output: string): TaskViewModel {
  const lines = output.split('\n')
  const head = lines[0]?.match(/^Task #(\S+): (.*)$/)
  if (!head) return { kind: 'get', task: null }
  let index = 1
  let status: TaskStatus | null = null
  const statusLine = lines[index]?.match(/^Status: (\S+)$/)
  if (statusLine) {
    status = taskStatusOf(statusLine[1])
    index++
  }
  let description: string | null = null
  if (lines[index]?.startsWith('Description: ')) {
    const parts = [(lines[index] ?? '').slice('Description: '.length)]
    index++
    while (index < lines.length && !/^(Blocked by|Blocks): /.test(lines[index] ?? '')) {
      parts.push(lines[index] ?? '')
      index++
    }
    description = parts.join('\n').trim() || null
  }
  let blockedBy: string[] = []
  let blocks: string[] = []
  for (; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const blocked = line.match(/^Blocked by: (.+)$/)
    if (blocked) blockedBy = hashIds(blocked[1] ?? '')
    const blocking = line.match(/^Blocks: (.+)$/)
    if (blocking) blocks = hashIds(blocking[1] ?? '')
  }
  return { kind: 'get', task: { id: head[1] ?? '', subject: head[2] ?? '', status, description, blocks, blockedBy } }
}

/** 更新动作额外的 `deleted` 是操作而非任务状态；其余场景只接受三个真实状态。 */
function statusOf(value: unknown): TaskStatus | 'deleted' | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted' ? value : null
}

function taskStatusOf(value: unknown): TaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

/** `#1, #3` → `['1', '3']`。 */
function hashIds(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^#/, ''))
    .filter(Boolean)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
