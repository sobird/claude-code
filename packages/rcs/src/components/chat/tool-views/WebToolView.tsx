'use client'

/** 网页正文：抓取地址或搜索词加结果文本；两者皆无时退回通用正文。 */

import { Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'
import { formatBytes, formatDuration, safeHttpUrl, webViewModel } from './web-model'

import styles from './WebToolView.module.css'

export function WebToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
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
        {model.httpStatus !== null ? (
          <span
            className={styles.stat}
          >{`${model.httpStatus}${model.httpStatusText ? ` ${model.httpStatusText}` : ''}`}</span>
        ) : null}
        {model.bytes !== null ? <span className={styles.stat}>{formatBytes(model.bytes)}</span> : null}
        {model.durationMs !== null ? <span className={styles.stat}>{formatDuration(model.durationMs)}</span> : null}
        {model.sources.length > 0 ? (
          <span className={styles.stat}>{t('webSources', { count: model.sources.length })}</span>
        ) : null}
      </div>
      {model.sources.length > 0 ? (
        <ul className={styles.sources}>
          {model.sources.map((source, index) => (
            <li key={index}>
              <a className={styles.sourceLink} href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {model.output ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
