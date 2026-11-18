'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatEpochSeconds } from '../../lib/format'
import { cx } from '../../lib/utils'
import { StatusBadge } from './StatusBadge'
import type { EnvironmentSummary } from './types'

import styles from './EnvironmentList.module.css'

interface EnvironmentListProps {
  environments: EnvironmentSummary[]
}

/** Active bridge/ACP environments the user can dispatch sessions onto. */
export function EnvironmentList({ environments }: EnvironmentListProps) {
  const t = useTranslations('dashboard')
  const locale = useLocale()

  if (environments.length === 0) {
    return (
      <div className={styles.empty}>
        {t.rich('environments.empty', {
          code: (chunks) => <code className={styles.code}>{chunks}</code>,
        })}
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {environments.map((environment) => {
        const isAcp = environment.worker_type === 'acp'
        return (
          <div key={environment.id} className={styles.row}>
            <div className={styles.rowBody}>
              <div className={styles.nameRow}>
                <span className={styles.name}>{environment.machine_name || environment.id}</span>
                <span className={cx(styles.typeBadge, isAcp ? styles.typeAcp : styles.typeClaude)}>
                  {isAcp ? t('environments.acpAgent') : t('environments.claudeCode')}
                </span>
              </div>
              <div className={styles.directory}>{environment.directory || ''}</div>
            </div>
            <div className={styles.meta}>
              <StatusBadge status={environment.status} />
              <div className={styles.metaLine}>
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
