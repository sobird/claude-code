'use client'

/**
 * Agent plan visualization — progress bar, per-entry status, and priority badge.
 * Ported as-is from the legacy Vite `PlanView`.
 */

import { CheckCircle2, ChevronRight, Circle, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { PlanDisplayEntry, PlanEntry, PlanEntryPriority, PlanEntryStatus } from '@/lib/session-reducer'
import { cx } from '@/lib/utils'

import styles from './PlanView.module.css'

export function PlanView({ entry }: { entry: PlanDisplayEntry }) {
  const t = useTranslations('chat')
  const [collapsed, setCollapsed] = useState(false)
  const { entries } = entry

  if (entries.length === 0) return null

  const completed = entries.filter((item) => item.status === 'completed').length
  const total = entries.length
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className={styles.root}>
      <div className={styles.box}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <ChevronRight className={cx(styles.chevron, !collapsed && styles.chevronOpen)} aria-hidden="true" />
          <span className={styles.heading}>{t('planTitle')}</span>
          <span className={styles.count}>
            {completed}/{total}
          </span>
          <div className={styles.track}>
            <div className={styles.bar} style={{ width: `${percentage}%` }} />
          </div>
          <span className={styles.percentage}>{percentage}%</span>
        </button>

        {!collapsed ? (
          <div className={cx(styles.entries, total > 5 && styles.entriesScroll)}>
            {entries.map((planEntry) => (
              <PlanEntryRow key={`${planEntry.priority}-${planEntry.content}`} entry={planEntry} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PlanEntryRow({ entry }: { entry: PlanEntry }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowIconWrap}>
        <StatusIcon status={entry.status} />
      </span>
      <span
        className={cx(
          styles.entryContent,
          entry.status === 'completed' ? styles.done : styles.pendingText,
          entry.status === 'in_progress' && styles.active,
        )}
      >
        {entry.content}
      </span>
      <PriorityBadge priority={entry.priority} />
    </div>
  )
}

function StatusIcon({ status }: { status: PlanEntryStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={cx(styles.statusIcon, styles.statusActive)} aria-hidden="true" />
    case 'in_progress':
      return <Loader2 className={styles.spinner} style={{ animationDuration: '2s' }} aria-hidden="true" />
    case 'pending':
    default:
      return <Circle className={cx(styles.statusIcon, styles.statusMuted)} aria-hidden="true" />
  }
}

const PRIORITY_STYLES: Record<PlanEntryPriority, string> = {
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
}

function PriorityBadge({ priority }: { priority: PlanEntryPriority }) {
  const t = useTranslations('chat.priority')
  return <span className={cx(styles.priority, PRIORITY_STYLES[priority])}>{t(priority)}</span>
}
