'use client'

import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

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

/** Statuses with localized copy under `common.status`; others render verbatim. */
const LABELED_STATUSES = [
  'active',
  'running',
  'idle',
  'inactive',
  'requires_action',
  'archived',
  'error',
  'online',
  'offline',
] as const

type LabeledStatus = (typeof LABELED_STATUSES)[number]

const LABELED_STATUS_SET: ReadonlySet<string> = new Set(LABELED_STATUSES)

function isLabeledStatus(value: string): value is LabeledStatus {
  return LABELED_STATUS_SET.has(value)
}

/** 色彩变体：awaiting 细分（审批/提问/计划）复用同一枚徽标，只换色调。 */
export type StatusTone = 'warning' | 'info' | 'plan'

const toneStyles: Record<StatusTone, string> = {
  warning: styles.requiresAction,
  info: styles.info,
  plan: styles.plan,
}

interface StatusBadgeProps {
  status: string
  /** 覆盖默认文案，例如把 `requires_action` 细分成"待审批"。 */
  label?: string
  /** 覆盖默认配色。 */
  tone?: StatusTone
}

/** Small pill describing a session or environment status. */
export function StatusBadge({ status, label, tone }: StatusBadgeProps) {
  const t = useTranslations('common')
  const text = label ?? (isLabeledStatus(status) ? t(`status.${status}`) : status)
  const toneClass = tone ? toneStyles[tone] : (statusStyles[status] ?? styles.fallback)
  return <span className={cx(styles.badge, toneClass)}>{text}</span>
}
