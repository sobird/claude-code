'use client'

/**
 * Chat composer. Enter sends (mid-turn messages are queued by the CLI), Shift+Enter
 * inserts a newline, and Escape/Stop interrupt while the agent is running.
 */

import { Send, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState } from 'react'

import { resolveComposerKey } from '../../lib/composer-keys'
import { cn } from '../../lib/utils'

interface ChatInputProps {
  /** May reject; on rejection the draft is kept so the user can retry. */
  onSubmit: (text: string) => Promise<void> | void
  onInterrupt?: () => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function ChatInput({
  onSubmit,
  onInterrupt,
  isLoading = false,
  disabled = false,
  placeholder,
  className,
}: ChatInputProps) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || sending) return
    setSending(true)
    try {
      await onSubmit(trimmed)
      // Only clear once the send resolved; a failure keeps the text so the
      // user can retry (the parent surfaces the error).
      setText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch {
      // Keep the draft; the parent already shows the error.
    } finally {
      setSending(false)
    }
  }, [text, disabled, sending, onSubmit])

  const handleInput = useCallback((target: HTMLTextAreaElement) => {
    setText(target.value)
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }, [])

  const canSend = text.trim().length > 0 && !disabled && !sending
  const resolvedPlaceholder = placeholder ?? t('placeholder', { product: tCommon('claude') })

  return (
    <div className={cn('mx-auto w-full max-w-3xl', className)}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2 transition-all focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(201,100,66,0.15)]">
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target)}
            onKeyDown={(event) => {
              const action = resolveComposerKey({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                isLoading,
              })
              if (action === 'submit') {
                event.preventDefault()
                void handleSubmit()
              } else if (action === 'interrupt') {
                event.preventDefault()
                onInterrupt?.()
              }
            }}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            rows={1}
            className="max-h-[200px] min-h-[24px] flex-1 resize-none border-none bg-transparent font-display text-sm leading-normal text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
          />
          {isLoading && onInterrupt ? (
            <button
              type="button"
              onClick={onInterrupt}
              aria-label={t('interrupt')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-text-primary text-surface-2 transition-all hover:bg-text-secondary sm:h-8 sm:w-8"
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSend}
            aria-label={t('send')}
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-all sm:h-8 sm:w-8',
              canSend
                ? 'bg-brand text-white hover:bg-brand-light hover:scale-[1.05] active:scale-[0.97]'
                : 'bg-surface-1 text-text-muted',
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-1.5 text-center">
        <span className="font-display text-[11px] text-text-muted">{isLoading ? t('busyHint') : t('enterHint')}</span>
      </div>
    </div>
  )
}
