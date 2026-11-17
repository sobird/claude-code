'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatEpochSeconds } from '../../lib/format'
import { StatusBadge } from './status-badge'
import type { EnvironmentSummary } from './types'

interface EnvironmentListProps {
  environments: EnvironmentSummary[]
}

/** Active bridge/ACP environments the user can dispatch sessions onto. */
export function EnvironmentList({ environments }: EnvironmentListProps) {
  const t = useTranslations('dashboard')
  const locale = useLocale()

  if (environments.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">
        {t.rich('environments.empty', {
          code: (chunks) => (
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-primary">{chunks}</code>
          ),
        })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {environments.map((environment) => {
        const isAcp = environment.worker_type === 'acp'
        return (
          <div
            key={environment.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-text-primary">
                  {environment.machine_name || environment.id}
                </span>
                <span
                  className={
                    isAcp
                      ? 'rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand'
                      : 'rounded-full bg-status-running/15 px-2 py-0.5 text-xs font-medium text-status-running'
                  }
                >
                  {isAcp ? t('environments.acpAgent') : t('environments.claudeCode')}
                </span>
              </div>
              <div className="truncate text-sm text-text-muted">{environment.directory || ''}</div>
            </div>
            <div className="flex-shrink-0 text-right">
              <StatusBadge status={environment.status} />
              <div className="mt-1 text-xs text-text-muted">
                {environment.branch || ''}
                {environment.branch && environment.last_poll_at ? ' · ' : ''}
                {environment.last_poll_at ? formatEpochSeconds(environment.last_poll_at, locale) : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
