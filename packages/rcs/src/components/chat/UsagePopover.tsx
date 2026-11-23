'use client'

/** 会话头部的令牌用量气泡：紧凑显示提示总量，点开后看提示/缓存/输出/合计的分行数字。 */

import { Popover } from '@base-ui/react/popover'
import { Gauge } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { formatTokenCount, promptTokens, usageRows, type TokenUsage } from '@/lib/token-usage'

import styles from './UsagePopover.module.css'

export function UsagePopover({ usage }: { usage: TokenUsage }) {
  const t = useTranslations('session.view.usage')

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<button type="button" data-testid="token-usage" aria-label={t('label')} className={styles.trigger} />}
      >
        <Gauge className={styles.icon} aria-hidden="true" />
        {t('compact', { count: formatTokenCount(promptTokens(usage)) })}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className={styles.positioner}>
          <Popover.Popup className={styles.popup} aria-label={t('label')}>
            <dl className={styles.rows}>
              {usageRows(usage).map((row) => (
                <div key={row.key} className={styles.row}>
                  <dt className={styles.term}>{t(row.key)}</dt>
                  <dd className={styles.value} title={String(row.value)}>
                    {formatTokenCount(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
