'use client'

import { Archive, ArchiveRestore } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { formatEpochSeconds } from '@/lib/format'

import { StatusBadge } from './StatusBadge'
import type { SessionSummary } from './types'

import styles from './SessionList.module.css'

interface SessionListProps {
  sessions: SessionSummary[]
  /** 提供时每行显示归档按钮；链接与按钮是兄弟节点，避免交互元素嵌套。 */
  onArchive?: (session: SessionSummary) => void
  /** 提供时每行显示恢复按钮（用于已归档列表）。 */
  onRestore?: (session: SessionSummary) => void
  /** 正在恢复的会话 id；该行按钮在请求期间禁用。 */
  restoringId?: string
}

/** Newest-first session rows; each links to `/<session id>`. */
export function SessionList({ sessions, onArchive, onRestore, restoringId }: SessionListProps) {
  const t = useTranslations('session')
  const tArchive = useTranslations('session.archive')
  const tRestore = useTranslations('session.restore')
  const locale = useLocale()

  if (sessions.length === 0) {
    return <div className={styles.empty}>{t('list.empty')}</div>
  }

  const sorted = sessions.toSorted((a, b) => (b.updated_at || 0) - (a.updated_at || 0))

  return (
    <div className={styles.list}>
      {sorted.map((session) => (
        <div key={session.id} className={styles.row}>
          <Link href={`/${session.id}`} className={styles.rowLink}>
            <div className={styles.rowBody}>
              <div className={styles.title}>{session.title || session.id}</div>
              <div className={styles.id}>{session.id}</div>
            </div>
            <div className={styles.meta}>
              <StatusBadge status={session.status} />
              <span className={styles.date}>{formatEpochSeconds(session.updated_at, locale)}</span>
            </div>
          </Link>
          {onArchive ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={styles.archiveButton}
              aria-label={tArchive('action')}
              title={tArchive('action')}
              onClick={() => onArchive(session)}
            >
              <Archive className={styles.archiveIcon} />
            </Button>
          ) : null}
          {onRestore ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={styles.archiveButton}
              aria-label={tRestore('action')}
              title={tRestore('action')}
              disabled={restoringId === session.id}
              onClick={() => onRestore(session)}
            >
              <ArchiveRestore className={styles.archiveIcon} />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
