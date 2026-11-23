'use client'

/** AskUserQuestion 正文：问题、选项与已回答结果；没有可解析的问题时退回通用正文。 */

import { CheckCircle2, Circle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

import { GenericToolBody } from './GenericToolBody'
import { questionViewModel } from './question-model'
import type { ToolViewProps } from './types'

import styles from './QuestionToolView.module.css'

export function QuestionToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = questionViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  const awaiting = !model.answered && (tool.status === 'running' || tool.status === 'waiting_for_confirmation')
  return (
    <>
      {model.answered || awaiting ? (
        <div className={cx(styles.status, model.answered ? styles.answered : styles.awaiting)}>
          {model.answered ? t('answered') : t('awaitingAnswer')}
        </div>
      ) : null}
      {model.items.map((item, questionIndex) => (
        <div key={questionIndex} className={styles.question}>
          <div className={styles.head}>
            <span className={styles.index}>{questionIndex + 1}</span>
            {item.header ? <span className={styles.header}>{item.header}</span> : null}
            {item.multiSelect ? <span className={styles.multi}>{t('questionMultiSelect')}</span> : null}
          </div>
          <p className={styles.text}>{item.question}</p>
          <ul className={styles.options}>
            {item.options.map((option) => (
              <li key={option.label} className={cx(styles.option, option.selected && styles.selected)}>
                {option.selected ? (
                  <CheckCircle2 className={styles.optionIcon} aria-hidden="true" />
                ) : (
                  <Circle className={styles.optionIcon} aria-hidden="true" />
                )}
                <span className={styles.optionBody}>
                  <span className={styles.optionLabel}>
                    {option.label}
                    {option.selected ? <span className={styles.selectedChip}>{t('selected')}</span> : null}
                  </span>
                  {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {item.other.length > 0 ? (
            <p className={styles.other}>{t('questionOther', { answer: item.other.join(', ') })}</p>
          ) : null}
        </div>
      ))}
    </>
  )
}
