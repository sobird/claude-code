'use client'

/**
 * Persistent task list above the composer, mirroring the TUI's todo status.
 *
 * Derived from the latest `TodoWrite` input (see `lib/tasks.ts`). Collapsed by
 * default: the summary carries the progress bar and the item being worked on;
 * expanding reveals the full list. Hidden entirely once everything is done.
 */

import { CheckCircle2, ChevronDown, Circle, CircleDot, ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { shouldShowTaskPanel, taskProgress, type TaskItem } from '../../lib/tasks'
import { cn } from '../../lib/utils'

function TaskIcon({ status }: { status: TaskItem['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-brand" />
  if (status === 'in_progress') return <CircleDot className="h-3.5 w-3.5 flex-shrink-0 text-brand" />
  return <Circle className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
}

export function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  const t = useTranslations('chat.tasks')
  if (!shouldShowTaskPanel(tasks)) return null

  const { done, total } = taskProgress(tasks)
  const active = tasks.find((task) => task.status === 'in_progress')
  const activeLabel = active ? (active.activeForm ?? active.content) : t('waiting')
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <details data-testid="task-panel" className="group rounded-xl border border-border bg-surface-1 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-text-secondary [&::-webkit-details-marker]:hidden">
        <ListChecks className="h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
        <span className="font-display font-medium text-text-primary">{t('title')}</span>
        <span className="font-mono text-[11px] text-text-muted" data-testid="task-panel-progress">
          {t('progress', { done, total })}
        </span>
        <span className="min-w-0 flex-1 truncate text-text-muted">{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-2 space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className="mt-0.5">
              <TaskIcon status={task.status} />
            </span>
            <span
              className={cn(
                'min-w-0 flex-1',
                task.status === 'completed' ? 'text-text-muted line-through' : 'text-text-secondary',
                task.status === 'in_progress' && 'font-medium text-text-primary',
              )}
            >
              {task.content}
              {task.status === 'in_progress' && task.activeForm ? (
                <span className="ml-1.5 text-[11px] font-normal text-text-muted">· {task.activeForm}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
