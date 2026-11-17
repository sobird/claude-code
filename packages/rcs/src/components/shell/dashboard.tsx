'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { useDashboardData } from './dashboard-data'
import { EnvironmentList } from './environment-list'
import { NewSessionDialog } from './new-session-dialog'
import { selectVisibleEnvironments, selectVisibleSessions } from './selectors'
import { SessionList } from './session-list'
import { toOwnedEnvironments, toOwnedSessions, type CreatedSession, type DashboardUser } from './types'

function SectionSkeletons({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-[68px] rounded-xl border border-border" />
      ))}
    </div>
  )
}

function CliHint() {
  const t = useTranslations('dashboard')
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border bg-surface-1 p-8 text-center">
      <p className="text-sm font-medium text-text-primary">{t('sessions.empty.title')}</p>
      <p className="text-sm text-text-muted">{t('sessions.empty.description')}</p>
      <pre className="mx-auto max-w-full overflow-x-auto rounded-lg border border-border bg-surface-0 px-3 py-2 text-left font-mono text-xs text-text-secondary">
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
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">{tCommon('dashboard')}</h1>
        <p className="text-sm text-text-secondary">{t('description')}</p>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="environments-heading" className="space-y-4">
        <h2 id="environments-heading" className="font-display text-lg font-semibold text-text-primary">
          {t('environments.title')}
        </h2>
        {loading && environments.length === 0 ? (
          <SectionSkeletons rows={2} />
        ) : error && visibleEnvironments.length === 0 ? null : (
          <EnvironmentList environments={visibleEnvironments} />
        )}
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sessions-heading" className="font-display text-lg font-semibold text-text-primary">
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
        <section aria-labelledby="unclaimed-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="unclaimed-heading" className="font-display text-lg font-semibold text-text-primary">
              {t('unclaimed.title')}
            </h2>
            <p className="text-sm text-text-muted">{t('unclaimed.description')}</p>
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
