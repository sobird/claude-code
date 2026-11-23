'use client'

/** 网页正文：抓取地址或搜索词加结果文本；两者皆无时退回通用正文。 */

import { Globe } from 'lucide-react'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'
import { safeHttpUrl, webViewModel } from './web-model'

import styles from './WebToolView.module.css'

export function WebToolView({ tool }: ToolViewProps) {
  const model = webViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  const link = safeHttpUrl(model.url)
  return (
    <>
      <div className={styles.targetRow}>
        <Globe className={styles.targetIcon} aria-hidden="true" />
        {link ? (
          <a className={styles.link} href={link} target="_blank" rel="noreferrer">
            {model.url}
          </a>
        ) : (
          <span className={styles.target}>{model.url || model.query}</span>
        )}
      </div>
      {model.output ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
