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
  const added = model.diff ? new Set(model.diff.added) : null
  return (
    <>
      <div className={styles.progressRow}>
        <span>{t('todoProgress', { done: model.done, total: model.total })}</span>
        {model.diff && model.diff.totalDelta !== 0 ? (
          <span className={styles.deltaChip}>{`${model.total - model.diff.totalDelta}→${model.total}`}</span>
        ) : null}
        {model.diff && model.diff.completedDelta > 0 ? (
          <span className={styles.doneChip}>{t('todoDoneDelta', { count: model.diff.completedDelta })}</span>
        ) : null}
      </div>
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
              {added?.has(item.content) ? <span className={styles.addedTag}>{t('todoAddedTag')}</span> : null}
            </li>
          )
        })}
      </ul>
      {model.errored && model.output ? <CollapsibleOutput text={model.output} errored /> : null}
    </>
  )
}
