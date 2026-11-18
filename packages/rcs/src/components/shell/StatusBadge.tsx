'use client'

import { useTranslations } from 'next-intl'

import { cx } from '../../lib/utils'

import styles from './StatusBadge.module.css'

const statusStyles: Record<string, string> = {
  active: styles.active,
  running: styles.running,
  idle: styles.idle,
  inactive: styles.inactive,
  requires_action: styles.requiresAction,
  archived: styles.archived,
  error: styles.error,
}

/** Small pill describing a session or environment status. */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('common')
  const label = t.has(`status.${status}`) ? t(`status.${status}`) : status
  return <span className={cx(styles.badge, statusStyles[status] ?? styles.fallback)}>{label}</span>
}
