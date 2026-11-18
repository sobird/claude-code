'use client'

/**
 * `/btw` aside card above the composer.
 *
 * The answer comes from a forked agent that shares the current conversation's
 * prompt cache but runs no tools and never becomes part of the transcript — the
 * exchange is transient by design (refresh drops it). The card mirrors the
 * TUI's modal: a spinner while answering, the Markdown answer when it lands,
 * and a retry for failures. A pending card stays visible while the main turn
 * keeps running, which is the whole point of `/btw`.
 */

import { Loader2, MessageCircleQuestion, RotateCcw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { MarkdownText } from './markdown'

export interface SideQuestionState {
  question: string
  status: 'pending' | 'done' | 'error'
  /** Trimmed answer; null when the forked agent produced no text. */
  answer: string | null
  /** Localized failure message; only set when `status === 'error'`. */
  error: string | null
}

export function SideQuestionCard({
  state,
  onClose,
  onRetry,
}: {
  /** Null hides the card entirely. */
  state: SideQuestionState | null
  onClose: () => void
  onRetry: () => void
}) {
  const t = useTranslations('chat.sideQuestion')

  useEffect(() => {
    if (!state) return undefined
    // The composer owns Escape (interrupt) and marks it handled; only close
    // the card when nothing else claimed the key.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state, onClose])

  if (!state) return null

  return (
    <section
      data-testid="side-question-card"
      aria-live="polite"
      className="rounded-xl border border-border bg-surface-1 px-3 py-2"
    >
      <header className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-xs font-medium text-text-primary">
            <span>{t('title')}</span>
            {state.status === 'pending' ? (
              <Loader2 className="h-3 w-3 animate-spin text-brand" aria-hidden="true" />
            ) : null}
          </div>
          <div className="truncate text-[11px] text-text-muted" title={state.question}>
            {state.question}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          title={t('close')}
          data-testid="side-question-close"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="mt-2 text-xs leading-relaxed text-text-secondary">
        {state.status === 'pending' ? (
          <span className="text-text-muted" data-testid="side-question-answering">
            {t('answering')}
          </span>
        ) : state.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="side-question-error">
            <span className="text-status-error">{state.error || t('error')}</span>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-brand"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t('retry')}
            </button>
          </div>
        ) : state.answer !== null ? (
          <div data-testid="side-question-answer">
            <MarkdownText text={state.answer} />
          </div>
        ) : (
          <span className="text-text-muted" data-testid="side-question-empty">
            {t('empty')}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-text-muted">{t('hint')}</p>
    </section>
  )
}
