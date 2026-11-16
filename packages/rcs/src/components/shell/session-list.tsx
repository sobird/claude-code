import Link from 'next/link'

import { formatTime } from '../../lib/utils'
import { StatusBadge } from './status-badge'
import type { SessionSummary } from './types'

interface SessionListProps {
  sessions: SessionSummary[]
  emptyMessage?: string
}

/** Newest-first session rows; each links to `/code/<session id>`. */
export function SessionList({ sessions, emptyMessage = 'No sessions yet.' }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">
        {emptyMessage}
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
            <span className="hidden text-xs text-text-muted sm:inline">{formatTime(session.updated_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
