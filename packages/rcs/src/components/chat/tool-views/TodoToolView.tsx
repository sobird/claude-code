'use client'

/** TodoWrite 正文：任务清单加完成进度；无任务清单时退回通用正文。 */

import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import { todoViewModel } from './todo-model'
import type { ToolViewProps } from './types'

import styles from './TodoToolView.module.css'

export function TodoToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = todoViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.progressRow}>{t('todoProgress', { done: model.done, total: model.total })}</div>
      <ul className={styles.list}>
        {model.items.map((item) => {
          const Icon = item.status === 'completed' ? CheckCircle2 : item.status === 'in_progress' ? CircleDot : Circle
          return (
            <li
              key={item.id}
              className={cx(
                styles.item,
                item.status === 'completed' && styles.completed,
                item.status === 'in_progress' && styles.current,
              )}
            >
              <Icon className={styles.icon} aria-hidden="true" />
              <span className={styles.text}>{item.content}</span>
            </li>
          )
        })}
      </ul>
      {model.errored && model.output ? <CollapsibleOutput text={model.output} errored /> : null}
    </>
  )
}
