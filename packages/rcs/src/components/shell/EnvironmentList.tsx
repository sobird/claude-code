'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatEpochSeconds } from '@/lib/format'
import { cx } from '@/lib/utils'

import { environmentTypeLabel } from './environment-type'
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
        // 未知类型不冒充 Claude Code：文案退回原始 worker_type，徽标用中性色。
        let typeClass: string = styles.typeOther
        let typeText: string = environment.worker_type
        switch (environmentTypeLabel(environment.worker_type)) {
          case 'acpAgent':
            typeClass = styles.typeAcp
            typeText = t('environments.acpAgent')
            break
          case 'claudeCode':
            typeClass = styles.typeClaude
            typeText = t('environments.claudeCode')
            break
          case 'deepseek':
            typeClass = styles.typeDeepseek
            typeText = t('environments.deepseek')
            break
        }
        return (
          <div key={environment.id} className={styles.row}>
            <div className={styles.rowBody}>
              <div className={styles.nameRow}>
                <span className={styles.name}>{environment.machine_name || environment.id}</span>
                <span className={cx(styles.typeBadge, typeClass)}>{typeText}</span>
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
