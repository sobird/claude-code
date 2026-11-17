/**
 * Session task list shown above the composer.
 *
 * The bridge never forwards `task_state` from this CLI, so the list is derived
 * from `TodoWrite` tool inputs — the same source the TUI reads. `task_state`
 * payloads are honored too, in case an upstream bridge emits them.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskItem {
  id: string
  content: string
  status: TaskStatus
  activeForm?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function taskStatusOf(value: unknown): TaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

function parseTasks(
  value: unknown,
  contentOf: (item: Record<string, unknown>) => string,
  statusOf: (value: unknown) => TaskStatus | null,
  fallbackId: (index: number) => string,
): TaskItem[] | null {
  if (!Array.isArray(value)) return null
  const tasks: TaskItem[] = []
  for (let index = 0; index < value.length; index++) {
    const raw = asRecord(value[index])
    if (!raw) continue
    const content = contentOf(raw).trim()
    const status = statusOf(raw.status)
    if (!content || !status) continue
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId(index)
    const activeForm = typeof raw.activeForm === 'string' && raw.activeForm ? raw.activeForm : undefined
    tasks.push({ id, content, status, activeForm })
  }
  return tasks
}

/** `null` means "not a todo payload" — leave the current list untouched. */
export function tasksFromTodoWrite(input: unknown): TaskItem[] | null {
  const record = asRecord(input)
  if (!record) return null
  return parseTasks(
    record.todos,
    (item) => (typeof item.content === 'string' ? item.content : typeof item.subject === 'string' ? item.subject : ''),
    // The CLI always sends a valid status; an odd one still deserves a slot.
    (status) => taskStatusOf(status) ?? 'pending',
    (index) => String(index),
  )
}

/** Upstream `task_state` shape: `{ task_list_id, tasks: [{ id, subject, status }] }`. */
export function tasksFromTaskState(payload: unknown): TaskItem[] | null {
  const record = asRecord(payload)
  if (!record) return null
  return parseTasks(
    record.tasks,
    (item) => (typeof item.subject === 'string' ? item.subject : typeof item.content === 'string' ? item.content : ''),
    // task_state also reports deletions; unknown states mean "not a task here".
    taskStatusOf,
    (index) => String(index),
  )
}

export function taskProgress(tasks: TaskItem[]): { done: number; total: number } {
  return { done: tasks.filter((task) => task.status === 'completed').length, total: tasks.length }
}

/** A finished list lingers in state but should not keep the composer crowded. */
export function shouldShowTaskPanel(tasks: TaskItem[]): boolean {
  return tasks.some((task) => task.status !== 'completed')
}
