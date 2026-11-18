'use client'

/**
 * Renders the AskUserQuestion prompt: one radio group per single-select
 * question, checkboxes for multi-select, plus a free-text "Other" answer.
 * Submitting sends the full tool input back with the CLI's `answers` map
 * appended, which the transport forwards as `updatedInput`.
 */

import { HelpCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react'

import { resolveAskQuestionKey } from '../../lib/ask-question-keys'
import {
  buildAskUserAnswers,
  emptyDrafts,
  isAskUserComplete,
  parseAskUserQuestions,
  toggleOption,
} from '../../lib/ask-user-question'
import type { PermissionDecision } from '../../lib/permission-suggestions'
import type { PendingPermission } from '../../lib/session-reducer'
import { cx } from '../../lib/utils'
import { Button } from '../ui/Button'

import styles from './AskUserQuestionCard.module.css'

interface AskUserQuestionCardProps {
  request: PendingPermission
  onRespond?: (requestId: string, decision: PermissionDecision) => void
}

export function AskUserQuestionCard({ request, onRespond }: AskUserQuestionCardProps) {
  const t = useTranslations('chat.askUserQuestion')
  const questions = parseAskUserQuestions(request.toolInput)
  const [drafts, setDrafts] = useState(() => emptyDrafts(questions))
  const [activeQuestion, setActiveQuestion] = useState(0)
  const [activeOption, setActiveOption] = useState(0)
  const [keyboardActive, setKeyboardActive] = useState(false)
  const complete = isAskUserComplete(questions, drafts)
  const answers = buildAskUserAnswers(questions, drafts)
  // Like the CLI's review screen: partial answers submit with a warning, but
  // an entirely empty answer is blocked (Decline covers "answer nothing").
  const answered = Object.keys(answers).length > 0
  // Clamp instead of syncing so a shrinking question list never points past it.
  const currentQuestion = Math.min(activeQuestion, Math.max(questions.length - 1, 0))
  const question = questions[currentQuestion]
  const currentOption = Math.min(activeOption, Math.max((question?.options.length ?? 0) - 1, 0))

  const selectOption = (questionIndex: number, label: string) => {
    setDrafts((prev) => {
      const draft = prev[questionIndex] ?? { selected: [], other: '' }
      const multiSelect = questions[questionIndex]?.multiSelect ?? false
      // A radio choice replaces the free-text answer rather than joining it.
      const other = multiSelect ? draft.other : ''
      return {
        ...prev,
        [questionIndex]: { selected: toggleOption(draft.selected, label, multiSelect), other },
      }
    })
  }

  const changeOther = (questionIndex: number, value: string) => {
    setDrafts((prev) => {
      const draft = prev[questionIndex] ?? { selected: [], other: '' }
      const multiSelect = questions[questionIndex]?.multiSelect ?? false
      // A free-text answer replaces a radio choice; multi-select keeps both.
      const selected = !multiSelect && value ? [] : draft.selected
      return { ...prev, [questionIndex]: { selected, other: value } }
    })
  }

  const submit = () => {
    if (!answered) return
    onRespond?.(request.requestId, { approved: true, updatedInput: { ...request.toolInput, answers } })
  }

  // Number keys and arrows act only while focus is inside the card, so the
  // page's own shortcuts keep working everywhere else. Editable targets —
  // including the free-text answer — keep their keys.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = resolveAskQuestionKey({
      key: event.key,
      optionCount: question?.options.length ?? 0,
      inEditable: isEditableTarget(event.target),
      isComposing: event.nativeEvent.isComposing,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
    })
    if (action.action === 'ignore') return
    event.preventDefault()
    setKeyboardActive(true)

    switch (action.action) {
      case 'select': {
        const option = question?.options[action.index]
        if (option) {
          selectOption(currentQuestion, option.label)
          setActiveOption(action.index)
        }
        return
      }
      case 'next-question':
        setActiveQuestion(Math.min(currentQuestion + 1, questions.length - 1))
        setActiveOption(0)
        return
      case 'prev-question':
        setActiveQuestion(Math.max(currentQuestion - 1, 0))
        setActiveOption(0)
        return
      case 'next-option':
        setActiveOption(Math.min(currentOption + 1, Math.max((question?.options.length ?? 0) - 1, 0)))
        return
      case 'prev-option':
        setActiveOption(Math.max(currentOption - 1, 0))
        return
      case 'submit':
        submit()
        return
      case 'decline':
        onRespond?.(request.requestId, { approved: false })
        return
    }
  }

  return (
    <div
      role="group"
      // The card itself is a keyboard target: focusing it enables the shortcut
      // set even before an option is clicked.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus anchor for the card's shortcuts
      tabIndex={0}
      data-testid="ask-question-card"
      onKeyDown={handleKeyDown}
      onFocus={() => setKeyboardActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardActive(false)
      }}
      className={styles.card}
    >
      <div className={styles.header}>
        <HelpCircle className={styles.headerIcon} aria-hidden="true" />
        <span className={styles.cardTitle}>{t('title')}</span>
      </div>

      <div className={styles.questions}>
        {questions.map((question, questionIndex) => {
          const draft = drafts[questionIndex] ?? { selected: [], other: '' }
          const groupName = `ask-question-${questionIndex}`
          return (
            <fieldset key={`${groupName}-${question.question}`} className={styles.fieldset}>
              <legend className={styles.legend}>
                {question.header ? <span className={styles.questionHeader}>{question.header}</span> : null}
                <span className={styles.questionText}>{question.question}</span>
                <span className={styles.questionHint}>{question.multiSelect ? t('selectMany') : t('selectOne')}</span>
              </legend>

              <div className={styles.options}>
                {question.options.map((option, optionIndex) => {
                  const checked = draft.selected.includes(option.label)
                  const highlighted =
                    keyboardActive && questionIndex === currentQuestion && optionIndex === currentOption
                  return (
                    <label
                      key={`${groupName}-${option.label}`}
                      className={cx(
                        styles.option,
                        checked ? styles.optionChecked : styles.optionUnchecked,
                        highlighted && styles.optionHighlighted,
                      )}
                    >
                      <input
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={groupName}
                        className={styles.optionInput}
                        checked={checked}
                        onChange={() => selectOption(questionIndex, option.label)}
                      />
                      <span className={styles.optionBody}>
                        <span className={styles.optionText}>{option.label}</span>
                        {option.description ? (
                          <span className={styles.optionDescription}>{option.description}</span>
                        ) : null}
                        {option.preview ? <pre className={styles.optionPreview}>{option.preview}</pre> : null}
                      </span>
                    </label>
                  )
                })}

                <label className={styles.otherLabel}>
                  <span className={styles.otherTitle}>{t('other')}</span>
                  <input
                    type="text"
                    className={styles.otherInput}
                    placeholder={t('otherPlaceholder')}
                    value={draft.other}
                    onChange={(event) => changeOther(questionIndex, event.target.value)}
                  />
                </label>
              </div>
            </fieldset>
          )
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerButtons}>
          <Button type="button" variant="brand" className={styles.actionButton} disabled={!answered} onClick={submit}>
            {t('submit')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={styles.actionButton}
            onClick={() => onRespond?.(request.requestId, { approved: false })}
          >
            {t('decline')}
          </Button>
        </div>
        {!complete ? <p className={styles.incomplete}>{t('incomplete')}</p> : null}
      </div>
    </div>
  )
}

/**
 * Text entry keeps its own keys. Radios and checkboxes are deliberately excluded:
 * with one focused, digits/arrows/Enter still drive the card. Buttons are left
 * alone so Enter activates them normally.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type
    return type !== 'radio' && type !== 'checkbox'
  }
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true
  return element.closest('[role="button"]') !== null
}
