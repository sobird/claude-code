'use client'

/** 搜索正文：模式与范围加结果文本；缺少模式时退回通用正文。 */

import { Search } from 'lucide-react'

import { cx } from '@/lib/utils'

import { GenericToolBody } from './GenericToolBody'
import { searchViewModel } from './search-model'
import type { ToolViewProps } from './types'

import styles from './SearchToolView.module.css'

export function SearchToolView({ tool }: ToolViewProps) {
  const model = searchViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.queryRow}>
        <Search className={styles.queryIcon} aria-hidden="true" />
        <code className={styles.pattern}>{model.pattern}</code>
        {model.path ? <span className={styles.meta}>{model.path}</span> : null}
        {model.glob ? <span className={styles.meta}>{model.glob}</span> : null}
      </div>
      {model.output ? (
        <pre className={cx(styles.output, model.errored && styles.outputError)}>{model.output}</pre>
      ) : null}
    </>
  )
}
