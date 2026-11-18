'use client'

/**
 * Background-task indicator above the composer.
 *
 * The CLI holds the turn's `result` back while agents/workflows run in the
 * background (`task_started` → … → `task_notification`). The reducer folds
 * those events into `ChatState.backgroundTasks`; this panel shows what is
 * still running, with a live elapsed clock, so a remote reader knows what a
 * long "working…" turn is waiting on. Each row can send an SDK `stop_task`
 * control request; the row leaves on the task's own `task_notification`.
 * Hidden entirely when nothing runs.
 */

import { ChevronDown, Loader2, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { elapsedMs, type BackgroundTask } from '../../lib/background-tasks'
import { formatTokenCount } from '../../lib/token-usage'

import styles from './BackgroundTaskPanel.module.css'

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${seconds}s`
}

export function BackgroundTaskPanel({
  tasks,
  onStop,
}: {
  tasks: BackgroundTask[]
  /** Sends the SDK `stop_task` control request; the row leaves on its notification. */
  onStop?: (taskId: string) => void
}) {
  const t = useTranslations('chat.backgroundTasks')
  const [now, setNow] = useState(() => Date.now())
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())

  // Drives the per-task elapsed clock; one ticker for the whole list.
  useEffect(() => {
    if (tasks.length === 0) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tasks.length])

  // A stopped task disappears once its `task_notification` folds in; drop the
  // pending marker with it (and for tasks removed any other way).
  useEffect(() => {
    setStopping((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => tasks.some((task) => task.taskId === id)))
      return next.size === prev.size ? prev : next
    })
  }, [tasks])

  if (tasks.length === 0) return null

  return (
    <details data-testid="background-task-panel" className={styles.panel}>
      <summary className={styles.summary}>
        <Loader2 className={styles.spinner} aria-hidden="true" />
        <span className={styles.title} data-testid="background-task-panel-title">
          {t('title', { count: tasks.length })}
        </span>
        <span className={styles.spacer} />
        <ChevronDown className={styles.chevron} />
      </summary>

      <ul className={styles.list}>
        {tasks.map((task) => {
          const elapsed = elapsedMs(task, now) ?? task.usage?.durationMs ?? null
          const meta = [
            elapsed !== null ? t('elapsed', { duration: formatElapsed(elapsed) }) : null,
            task.usage ? t('tokens', { count: formatTokenCount(task.usage.totalTokens) }) : null,
            task.usage ? t('toolUses', { count: task.usage.toolUses }) : null,
            task.lastToolName ? t('lastTool', { tool: task.lastToolName }) : null,
          ].filter((item): item is string => item !== null)

          const isStopping = stopping.has(task.taskId)

          return (
            <li key={task.taskId} className={styles.item}>
              <div className={styles.itemBody}>
                <div className={styles.description}>{task.description || t('fallback')}</div>
                {meta.length > 0 ? <div className={styles.meta}>{meta.join(' · ')}</div> : null}
                {task.summary ? <div className={styles.summaryText}>{task.summary}</div> : null}
              </div>
              {onStop ? (
                <button
                  type="button"
                  className={styles.stop}
                  aria-label={isStopping ? t('stopping') : t('stop')}
                  disabled={isStopping}
                  onClick={() => {
                    setStopping((prev) => new Set(prev).add(task.taskId))
                    onStop(task.taskId)
                  }}
                >
                  {isStopping ? (
                    <Loader2 className={styles.stopSpinner} aria-hidden="true" />
                  ) : (
                    <Square className={styles.squareIcon} aria-hidden="true" />
                  )}
                  <span>{isStopping ? t('stopping') : t('stop')}</span>
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
