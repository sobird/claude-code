'use client'

/** 工具输出块：超过行数上限时折叠，正文完整保留，展开后显示全文。 */

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { cx } from '@/lib/utils'

import { shouldCollapseOutput } from './format'

import styles from './CollapsibleOutput.module.css'

interface CollapsibleOutputProps {
  text: string
  errored?: boolean
}

export function CollapsibleOutput({ text, errored = false }: CollapsibleOutputProps) {
  const t = useTranslations('chat')
  const [expanded, setExpanded] = useState(false)
  const collapsible = shouldCollapseOutput(text)
  const open = expanded || !collapsible
  const lines = text.split('\n').length

  return (
    <div className={styles.root}>
      <pre className={cx(styles.output, errored && styles.error, !open && styles.clamped)}>{text}</pre>
      {collapsible ? (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? t('collapseOutput') : t('expandOutput', { lines })}
        </button>
      ) : null}
    </div>
  )
}
