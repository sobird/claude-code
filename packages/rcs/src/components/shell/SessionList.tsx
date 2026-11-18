'use client'

import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { formatEpochSeconds } from '../../lib/format'
import { StatusBadge } from './StatusBadge'
import type { SessionSummary } from './types'

import styles from './SessionList.module.css'

interface SessionListProps {
  sessions: SessionSummary[]
}

/** Newest-first session rows; each links to `/<session id>`. */
export function SessionList({ sessions }: SessionListProps) {
  const t = useTranslations('session')
  const locale = useLocale()

  if (sessions.length === 0) {
    return <div className={styles.empty}>{t('list.empty')}</div>
  }

  const sorted = sessions.toSorted((a, b) => (b.updated_at || 0) - (a.updated_at || 0))

  return (
    <div className={styles.list}>
      {sorted.map((session) => (
        <Link key={session.id} href={`/${session.id}`} className={styles.row}>
          <div className={styles.rowBody}>
            <div className={styles.title}>{session.title || session.id}</div>
            <div className={styles.id}>{session.id}</div>
          </div>
          <div className={styles.meta}>
            <StatusBadge status={session.status} />
            <span className={styles.date}>{formatEpochSeconds(session.updated_at, locale)}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
