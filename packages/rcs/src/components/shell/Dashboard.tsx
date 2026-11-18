'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Skeleton'
import { useDashboardData } from './DashboardData'
import { EnvironmentList } from './EnvironmentList'
import { NewSessionDialog } from './NewSessionDialog'
import { selectVisibleEnvironments, selectVisibleSessions } from './selectors'
import { SessionList } from './SessionList'
import { toOwnedEnvironments, toOwnedSessions, type CreatedSession, type DashboardUser } from './types'

import styles from './Dashboard.module.css'

function SectionSkeletons({ rows }: { rows: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={styles.skeleton} />
      ))}
    </div>
  )
}

function CliHint() {
  const t = useTranslations('dashboard')
  return (
    <div className={styles.hint}>
      <p className={styles.hintTitle}>{t('sessions.empty.title')}</p>
      <p className={styles.hintDescription}>{t('sessions.empty.description')}</p>
      <pre className={styles.hintCommand}>
        <code>{t('sessions.empty.command')}</code>
      </pre>
    </div>
  )
}

/** Dashboard: environments, claimed sessions, and unclaimed sessions. */
export function Dashboard({ user }: { user: DashboardUser }) {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const tCommon = useTranslations('common')
  const { sessions, environments, loading, error, refresh, createSession } = useDashboardData()
  const [dialogOpen, setDialogOpen] = useState(false)

  const visibleSessions = selectVisibleSessions(toOwnedSessions(sessions), user)
  const claimedSessions = visibleSessions.filter((session) => session.owner !== null)
  const unclaimedSessions = visibleSessions.filter((session) => session.owner === null)
  const visibleEnvironments = selectVisibleEnvironments(toOwnedEnvironments(environments), user)

  function handleCreated(session: CreatedSession): void {
    setDialogOpen(false)
    router.push(`/${session.id}`)
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>{tCommon('dashboard')}</h1>
        <p className={styles.description}>{t('description')}</p>
      </header>

      {error ? (
        <div role="alert" className={styles.errorBanner}>
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="environments-heading" className={styles.section}>
        <h2 id="environments-heading" className={styles.sectionTitle}>
          {t('environments.title')}
        </h2>
        {loading && environments.length === 0 ? (
          <SectionSkeletons rows={2} />
        ) : error && visibleEnvironments.length === 0 ? null : (
          <EnvironmentList environments={visibleEnvironments} />
        )}
      </section>

      <section aria-labelledby="sessions-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="sessions-heading" className={styles.sectionTitle}>
            {tCommon('sessions')}
          </h2>
          <Button type="button" variant="brand" size="sm" onClick={() => setDialogOpen(true)}>
            {t('sessions.new')}
          </Button>
        </div>
        {loading && sessions.length === 0 ? (
          <SectionSkeletons rows={3} />
        ) : error && visibleSessions.length === 0 ? null : visibleSessions.length === 0 ? (
          <CliHint />
        ) : claimedSessions.length === 0 ? null : (
          <SessionList sessions={claimedSessions} />
        )}
      </section>

      {unclaimedSessions.length > 0 ? (
        <section aria-labelledby="unclaimed-heading" className={styles.section}>
          <div className={styles.intro}>
            <h2 id="unclaimed-heading" className={styles.sectionTitle}>
              {t('unclaimed.title')}
            </h2>
            <p className={styles.muted}>{t('unclaimed.description')}</p>
          </div>
          <SessionList sessions={unclaimedSessions} />
        </section>
      ) : null}

      <NewSessionDialog
        open={dialogOpen}
        environments={visibleEnvironments}
        onClose={() => setDialogOpen(false)}
        onCreate={createSession}
        onCreated={handleCreated}
      />
    </div>
  )
}
