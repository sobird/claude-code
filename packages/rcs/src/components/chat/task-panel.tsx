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
import { cx } from '../../lib/utils'

import styles from './task-panel.module.css'

function TaskIcon({ status }: { status: TaskItem['status'] }) {
  if (status === 'completed') return <CheckCircle2 className={cx(styles.taskIcon, styles.brand)} />
  if (status === 'in_progress') return <CircleDot className={cx(styles.taskIcon, styles.brand)} />
  return <Circle className={cx(styles.taskIcon, styles.muted)} />
}

export function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  const t = useTranslations('chat.tasks')
  if (!shouldShowTaskPanel(tasks)) return null

  const { done, total } = taskProgress(tasks)
  const active = tasks.find((task) => task.status === 'in_progress')
  const activeLabel = active ? (active.activeForm ?? active.content) : t('waiting')
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <details data-testid="task-panel" className={styles.panel}>
      <summary className={styles.summary}>
        <ListChecks className={styles.panelIcon} aria-hidden="true" />
        <span className={styles.title}>{t('title')}</span>
        <span className={styles.progress} data-testid="task-panel-progress">
          {t('progress', { done, total })}
        </span>
        <span className={styles.activeLabel}>{activeLabel}</span>
        <ChevronDown className={styles.chevron} />
      </summary>

      <div className={styles.track}>
        <div className={styles.bar} style={{ width: `${percent}%` }} />
      </div>

      <ul className={styles.list}>
        {tasks.map((task) => (
          <li key={task.id} className={styles.item}>
            <span className={styles.itemIconWrap}>
              <TaskIcon status={task.status} />
            </span>
            <span
              className={cx(
                styles.itemContent,
                task.status === 'completed' ? styles.done : styles.pendingText,
                task.status === 'in_progress' && styles.active,
              )}
            >
              {task.content}
              {task.status === 'in_progress' && task.activeForm ? (
                <span className={styles.activeForm}>· {task.activeForm}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
