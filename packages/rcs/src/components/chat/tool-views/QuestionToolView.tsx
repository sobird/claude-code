'use client'

/** AskUserQuestion 正文：问题、选项与已回答结果；没有可解析的问题时退回通用正文。 */

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
      {model.questions.map((question, questionIndex) => {
        const answer = model.answers[question.question]
        const chosen = answer ? answer.split(',').map((part) => part.trim()) : []
        const unmatched = chosen.filter((part) => !question.options.some((option) => option.label === part))
        return (
          <div key={questionIndex} className={styles.question}>
            {question.header ? <span className={styles.header}>{question.header}</span> : null}
            <p className={styles.text}>{question.question}</p>
            <ul className={styles.options}>
              {question.options.map((option) => {
                const selected = chosen.includes(option.label)
                return (
                  <li key={option.label} className={cx(styles.option, selected && styles.selected)}>
                    <span className={styles.optionLabel}>
                      {option.label}
                      {selected ? <span className={styles.selectedChip}>{t('selected')}</span> : null}
                    </span>
                    {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
                  </li>
                )
              })}
            </ul>
            {unmatched.length > 0 ? <p className={styles.other}>{unmatched.join(', ')}</p> : null}
          </div>
        )
      })}
    </>
  )
}
