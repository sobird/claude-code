'use client'

import { Archive, ArchiveRestore } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { formatEpochSeconds } from '@/lib/format'
import { cx } from '@/lib/utils'

import { sessionFace, sortSessions } from './session-status'
import { StatusBadge, type StatusTone } from './StatusBadge'
import type { AwaitingState, SessionSummary } from './types'

import styles from './SessionList.module.css'

const AWAITING_TONE: Record<AwaitingState['kind'], StatusTone> = {
  permission: 'warning',
  question: 'info',
  plan: 'plan',
}

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
  const tAwaiting = useTranslations('session.awaiting')
  const tArchive = useTranslations('session.archive')
  const tRestore = useTranslations('session.restore')
  const locale = useLocale()

  if (sessions.length === 0) {
    return <div className={styles.empty}>{t('list.empty')}</div>
  }

  const sorted = sortSessions(sessions)

  return (
    <div className={styles.list}>
      {sorted.map((session) => {
        const face = sessionFace(session)
        const awaiting = session.awaiting
        const showUnread = face === 'unread'
        return (
          <div key={session.id} className={cx(styles.row, face === 'awaiting' && styles.rowAwaiting)} data-face={face}>
            <Link href={`/${session.id}`} className={styles.rowLink} title={awaiting?.description ?? undefined}>
              <div className={styles.rowBody}>
                <div className={cx(styles.title, showUnread && styles.titleUnread)}>
                  {showUnread ? (
                    <span
                      className={cx(styles.unreadDot, session.last_result_failed && styles.unreadDotFailed)}
                      role="img"
                      aria-label={t('list.unread')}
                    />
                  ) : null}
                  <span className={styles.titleText}>{session.title || session.id}</span>
                </div>
                {awaiting?.description ? <div className={styles.description}>{awaiting.description}</div> : null}
                <div className={styles.id}>{session.id}</div>
              </div>
              <div className={styles.meta}>
                {awaiting ? (
                  <StatusBadge
                    status="requires_action"
                    label={tAwaiting(awaiting.kind)}
                    tone={AWAITING_TONE[awaiting.kind]}
                  />
                ) : (
                  <StatusBadge status={session.status} />
                )}
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
        )
      })}
    </div>
  )
}
