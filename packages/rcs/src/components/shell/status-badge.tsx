'use client'

import { useTranslations } from 'next-intl'

import { cn } from '../../lib/utils'

const statusStyles: Record<string, string> = {
  active: 'bg-status-active/15 text-status-active',
  running: 'bg-status-running/15 text-status-running',
  idle: 'bg-status-idle/15 text-status-idle',
  inactive: 'bg-text-muted/15 text-text-muted',
  requires_action: 'bg-status-warning/20 text-status-warning',
  archived: 'bg-text-muted/15 text-text-muted',
  error: 'bg-status-error/15 text-status-error',
}

/** Small pill describing a session or environment status. */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('common')
  const label = t.has(`status.${status}`) ? t(`status.${status}`) : status
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        statusStyles[status] ?? 'bg-surface-3 text-text-primary',
      )}
    >
      {label}
    </span>
  )
}
