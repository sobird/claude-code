'use client'

import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { formatEpochSeconds } from '../../lib/format'
import { StatusBadge } from './status-badge'
import type { SessionSummary } from './types'

interface SessionListProps {
  sessions: SessionSummary[]
}

/** Newest-first session rows; each links to `/code/<session id>`. */
export function SessionList({ sessions }: SessionListProps) {
  const t = useTranslations('session')
  const locale = useLocale()

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">
        {t('list.empty')}
      </div>
    )
  }

  const sorted = sessions.toSorted((a, b) => (b.updated_at || 0) - (a.updated_at || 0))

  return (
    <div className="space-y-2">
      {sorted.map((session) => (
        <Link
          key={session.id}
          href={`/${session.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3 no-underline transition-colors hover:border-border-light hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-text-primary">{session.title || session.id}</div>
            <div className="truncate font-mono text-xs text-text-muted">{session.id}</div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <StatusBadge status={session.status} />
            <span className="hidden text-xs text-text-muted sm:inline">
              {formatEpochSeconds(session.updated_at, locale)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
