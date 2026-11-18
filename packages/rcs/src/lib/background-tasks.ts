/**
 * Background-task bookkeeping for the web transcript.
 *
 * The CLI bridge child reports every background task (Agent calls, teammates,
 * workflows, background shells) through `system/task_started`,
 * `system/task_progress`, and `system/task_notification`. The gateway persists
 * those events, and this module folds them into the running list the composer
 * indicator shows. Task events are keyed by `task_id`; progress may arrive
 * without its start when history is truncated, so it creates a placeholder.
 */

export interface BackgroundTaskUsage {
  totalTokens: number
  toolUses: number
  durationMs: number
}

export interface BackgroundTask {
  taskId: string
  description: string
  toolUseId?: string
  taskType?: string
  /** Server/client time of the first `task_started`; null when unknown. */
  startedAt: number | null
  usage?: BackgroundTaskUsage
  lastToolName?: string
  summary?: string
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Sanitize the SDK `usage` object. Only the three counters survive; anything
 * else (including the CLI-host `output_file`) never reaches the browser.
 * Accepts the raw snake_case shape from the SDK as well as the camelCase
 * shape `normalizePayload` produces (the reducer sees the latter).
 */
export function sanitizeTaskUsage(value: unknown): BackgroundTaskUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const totalTokens = nonNegative(record.total_tokens) ?? nonNegative(record.totalTokens)
  const toolUses = nonNegative(record.tool_uses) ?? nonNegative(record.toolUses)
  const durationMs = nonNegative(record.duration_ms) ?? nonNegative(record.durationMs)
  if (totalTokens === null && toolUses === null && durationMs === null) return null
  return { totalTokens: totalTokens ?? 0, toolUses: toolUses ?? 0, durationMs: durationMs ?? 0 }
}

/** Insert or refresh a task from `task_started`, keeping its first start time. */
export function startBackgroundTask(
  prev: readonly BackgroundTask[],
  payload: Record<string, unknown>,
  at: number | null,
): BackgroundTask[] {
  const taskId = textOf(payload.task_id)
  if (!taskId) return prev as BackgroundTask[]

  const description = textOf(payload.description) ?? ''
  const toolUseId = textOf(payload.tool_use_id)
  const taskType = textOf(payload.task_type)

  const index = prev.findIndex((task) => task.taskId === taskId)
  if (index < 0) {
    return [
      ...prev,
      {
        taskId,
        description,
        startedAt: at,
        ...(toolUseId ? { toolUseId } : {}),
        ...(taskType ? { taskType } : {}),
      },
    ]
  }

  const existing = prev[index]
  const next = [...prev]
  next[index] = {
    ...existing,
    description: description || existing.description,
    startedAt: existing.startedAt ?? at,
    ...(toolUseId ? { toolUseId } : {}),
    ...(taskType ? { taskType } : {}),
  }
  return next
}

/**
 * Merge `task_progress` into its task. Unknown ids become placeholders so a
 * truncated history window still shows what is running.
 */
export function progressBackgroundTask(
  prev: readonly BackgroundTask[],
  payload: Record<string, unknown>,
  at: number | null,
): BackgroundTask[] {
  const taskId = textOf(payload.task_id)
  if (!taskId) return prev as BackgroundTask[]

  const description = textOf(payload.description)
  const usage = sanitizeTaskUsage(payload.usage)
  const lastToolName = textOf(payload.last_tool_name)
  const summary = textOf(payload.summary)

  const index = prev.findIndex((task) => task.taskId === taskId)
  const base: BackgroundTask = index >= 0 ? prev[index] : { taskId, description: description ?? '', startedAt: at }

  const next = { ...base }
  if (description) next.description = description
  if (usage) next.usage = usage
  if (lastToolName) next.lastToolName = lastToolName
  if (summary) next.summary = summary

  if (index < 0) return [...prev, next]
  const tasks = [...prev]
  tasks[index] = next
  return tasks
}

/** Drop a finished task; unknown or missing ids are a no-op. */
export function completeBackgroundTask(prev: readonly BackgroundTask[], taskId: string): BackgroundTask[] {
  if (!taskId) return prev as BackgroundTask[]
  const remaining = prev.filter((task) => task.taskId !== taskId)
  return remaining.length === prev.length ? (prev as BackgroundTask[]) : remaining
}

/** Wall-clock age of a task, clamped for clock skew; null when start is unknown. */
export function elapsedMs(task: BackgroundTask, now: number): number | null {
  if (task.startedAt === null) return null
  return Math.max(0, now - task.startedAt)
}
