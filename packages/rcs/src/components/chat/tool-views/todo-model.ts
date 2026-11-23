/** TodoWrite 正文：从工具输入取任务清单，复用会话任务面板的解析与统计。 */

import type { ToolCallData } from '@/lib/session-reducer'
import { taskProgress, tasksFromTodoWrite, type TaskItem } from '@/lib/tasks'

import { formatOutput } from './format'

/** 相对上一版清单的变化；条目以内容为键（该工具的条目常常没有稳定 id）。 */
export interface TodoDiff {
  /** 上一版里没有的条目内容。 */
  added: string[]
  /** 上一版里有、这一版已删掉的条目数。 */
  removed: number
  /** 完成数增量（可为负）。 */
  completedDelta: number
  /** 条目总数变化（可为负）。 */
  totalDelta: number
}

export interface TodoViewModel {
  items: TaskItem[]
  done: number
  total: number
  output: string
  errored: boolean
  /** 相对上一版清单的差异；第一次 TodoWrite（无基线）为 `null`。 */
  diff: TodoDiff | null
}

function diffTodos(baseline: TaskItem[], items: TaskItem[], done: number): TodoDiff {
  const previousContents = new Set(baseline.map((task) => task.content))
  const currentContents = new Set(items.map((task) => task.content))
  const previousDone = baseline.filter((task) => task.status === 'completed').length
  return {
    added: items.filter((task) => !previousContents.has(task.content)).map((task) => task.content),
    removed: baseline.filter((task) => !currentContents.has(task.content)).length,
    completedDelta: done - previousDone,
    totalDelta: items.length - baseline.length,
  }
}

export function todoViewModel(tool: ToolCallData): TodoViewModel | null {
  const items = tasksFromTodoWrite(tool.rawInput)
  if (!items || items.length === 0) return null
  const { done, total } = taskProgress(items)
  const baseline = tool.baselineTodos
  return {
    items,
    done,
    total,
    output: formatOutput(tool),
    errored: tool.status === 'error',
    diff: baseline ? diffTodos(baseline, items, done) : null,
  }
}
