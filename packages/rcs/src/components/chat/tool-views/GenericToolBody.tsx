'use client'

/**
 * 默认卡片正文：摘要字段、可折叠的原始输入、输出文本。
 * 未登记专用视图的工具都落到这里。
 */

import { useTranslations } from 'next-intl'

import { summarizeToolCall } from '@/lib/tool-summary'
import { cx } from '@/lib/utils'

import { formatOutput, OUTPUT_LIMIT, truncate } from './format'
import type { ToolViewProps } from './types'

import styles from '../ToolCallGroup.module.css'

export function GenericToolBody({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const summary = summarizeToolCall(tool.title, tool.rawInput)
  const hasOutput =
    tool.status !== 'running' &&
    tool.status !== 'waiting_for_confirmation' &&
    (tool.rawOutput !== undefined || tool.status === 'error')

  return (
    <>
      {summary.fields.length > 0 ? (
        <div className={styles.fields}>
          {summary.fields.map((field) => (
            <div key={field.key} className={styles.fieldRow}>
              <span className={styles.fieldKey}>{field.key}</span>
              <span className={styles.fieldValue}>{field.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {tool.rawInput && Object.keys(tool.rawInput).length > 0 ? (
        <details>
          <summary className={styles.rawSummary}>{t('toolRawInput')}</summary>
          <pre className={cx(styles.pre, styles.preInput)}>
            {truncate(JSON.stringify(tool.rawInput, null, 2), OUTPUT_LIMIT)}
          </pre>
        </details>
      ) : null}
      {hasOutput ? (
        <pre className={cx(styles.pre, tool.status === 'error' ? styles.preError : styles.preOutput)}>
          {formatOutput(tool)}
        </pre>
      ) : null}
    </>
  )
}
