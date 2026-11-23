'use client'

/** 搜索正文：模式与范围加结果文本；缺少模式时退回通用正文。 */

import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import { searchViewModel } from './search-model'
import type { ToolViewProps } from './types'

import styles from './SearchToolView.module.css'

export function SearchToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = searchViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.queryRow}>
        <Search className={styles.queryIcon} aria-hidden="true" />
        <code className={styles.pattern}>{model.pattern}</code>
        {model.path ? <span className={styles.meta}>{model.path}</span> : null}
        {model.glob ? <span className={styles.meta}>{model.glob}</span> : null}
        {model.matches !== null ? (
          <span className={styles.stat}>{t('searchMatches', { count: model.matches })}</span>
        ) : null}
        {model.files !== null ? <span className={styles.stat}>{t('searchFiles', { count: model.files })}</span> : null}
      </div>
      {model.output ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
