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

import { MarkdownText } from './Markdown'

import styles from './SideQuestionCard.module.css'

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
    <section data-testid="side-question-card" aria-live="polite" className={styles.card}>
      <header className={styles.header}>
        <MessageCircleQuestion className={styles.questionIcon} aria-hidden="true" />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span>{t('title')}</span>
            {state.status === 'pending' ? <Loader2 className={styles.spinner} aria-hidden="true" /> : null}
          </div>
          <div className={styles.question} title={state.question}>
            {state.question}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          title={t('close')}
          data-testid="side-question-close"
          className={styles.close}
        >
          <X className={styles.closeIcon} />
        </button>
      </header>

      <div className={styles.body}>
        {state.status === 'pending' ? (
          <span className={styles.muted} data-testid="side-question-answering">
            {t('answering')}
          </span>
        ) : state.status === 'error' ? (
          <div className={styles.errorRow} data-testid="side-question-error">
            <span className={styles.errorText}>{state.error || t('error')}</span>
            <button type="button" onClick={onRetry} className={styles.retry}>
              <RotateCcw className={styles.retryIcon} aria-hidden="true" />
              {t('retry')}
            </button>
          </div>
        ) : state.answer !== null ? (
          <div data-testid="side-question-answer">
            <MarkdownText text={state.answer} />
          </div>
        ) : (
          <span className={styles.muted} data-testid="side-question-empty">
            {t('empty')}
          </span>
        )}
      </div>

      <p className={styles.hint}>{t('hint')}</p>
    </section>
  )
}
