/** TodoWrite 正文：从工具输入取任务清单，复用会话任务面板的解析与统计。 */

import type { ToolCallData } from '@/lib/session-reducer'
import { taskProgress, tasksFromTodoWrite, type TaskItem } from '@/lib/tasks'

import { formatOutput } from './format'

export interface TodoViewModel {
  items: TaskItem[]
  done: number
  total: number
  output: string
  errored: boolean
}

export function todoViewModel(tool: ToolCallData): TodoViewModel | null {
  const items = tasksFromTodoWrite(tool.rawInput)
  if (!items || items.length === 0) return null
  const { done, total } = taskProgress(items)
  return { items, done, total, output: formatOutput(tool), errored: tool.status === 'error' }
}
