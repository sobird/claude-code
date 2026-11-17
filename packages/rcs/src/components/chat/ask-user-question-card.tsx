'use client'

/**
 * Renders the AskUserQuestion prompt: one radio group per single-select
 * question, checkboxes for multi-select, plus a free-text "Other" answer.
 * Submitting sends the full tool input back with the CLI's `answers` map
 * appended, which the transport forwards as `updatedInput`.
 */

import { HelpCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import {
  buildAskUserAnswers,
  emptyDrafts,
  isAskUserComplete,
  parseAskUserQuestions,
  toggleOption,
} from '../../lib/ask-user-question'
import type { PendingPermission } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

interface AskUserQuestionCardProps {
  request: PendingPermission
  onRespond?: (requestId: string, approved: boolean, updatedInput?: Record<string, unknown>) => void
}

export function AskUserQuestionCard({ request, onRespond }: AskUserQuestionCardProps) {
  const t = useTranslations('chat.askUserQuestion')
  const questions = parseAskUserQuestions(request.toolInput)
  const [drafts, setDrafts] = useState(() => emptyDrafts(questions))
  const complete = isAskUserComplete(questions, drafts)

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
    if (!complete) return
    onRespond?.(request.requestId, true, { ...request.toolInput, answers: buildAskUserAnswers(questions, drafts) })
  }

  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-brand/30 bg-brand/5 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2 text-text-primary">
        <HelpCircle className="h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
        <span className="font-display text-sm font-medium">{t('title')}</span>
      </div>

      <div className="mt-3 space-y-4">
        {questions.map((question, questionIndex) => {
          const draft = drafts[questionIndex] ?? { selected: [], other: '' }
          const groupName = `ask-question-${questionIndex}`
          return (
            <fieldset key={`${groupName}-${question.question}`} className="min-w-0">
              <legend className="w-full">
                {question.header ? (
                  <span className="block font-mono text-[10px] uppercase tracking-wide text-text-muted">
                    {question.header}
                  </span>
                ) : null}
                <span className="block text-sm font-medium text-text-primary">{question.question}</span>
                <span className="block text-[11px] text-text-muted">
                  {question.multiSelect ? t('selectMany') : t('selectOne')}
                </span>
              </legend>

              <div className="mt-2 space-y-1.5">
                {question.options.map((option) => {
                  const checked = draft.selected.includes(option.label)
                  return (
                    <label
                      key={`${groupName}-${option.label}`}
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors',
                        checked ? 'border-brand bg-brand/10' : 'border-border bg-surface-1 hover:bg-surface-2',
                      )}
                    >
                      <input
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={groupName}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand"
                        checked={checked}
                        onChange={() => selectOption(questionIndex, option.label)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm text-text-primary">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block text-xs text-text-muted">{option.description}</span>
                        ) : null}
                        {option.preview ? (
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2/70 p-2 font-mono text-[11px] text-text-secondary">
                            {option.preview}
                          </pre>
                        ) : null}
                      </span>
                    </label>
                  )
                })}

                <label className="flex cursor-text flex-col gap-1 rounded-lg border border-border bg-surface-1 px-3 py-2">
                  <span className="text-xs font-medium text-text-secondary">{t('other')}</span>
                  <input
                    type="text"
                    className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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

      <div className="mt-3 space-y-1.5">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="brand"
            className="h-11 flex-1 sm:h-9 sm:flex-none sm:px-4"
            disabled={!complete}
            onClick={submit}
          >
            {t('submit')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 sm:h-9 sm:flex-none sm:px-4"
            onClick={() => onRespond?.(request.requestId, false)}
          >
            {t('decline')}
          </Button>
        </div>
        {!complete ? <p className="text-[11px] text-text-muted">{t('incomplete')}</p> : null}
      </div>
    </div>
  )
}
