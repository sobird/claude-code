'use client'

/**
 * Chat composer. Enter sends (mid-turn messages are queued by the CLI), Shift+Enter
 * inserts a newline, and Escape/Stop interrupt while the agent is running.
 */

import { Send, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { acceptCommand, commandQuery, filterCommands, moveIndex } from '../../lib/command-menu'
import { resolveComposerKey } from '../../lib/composer-keys'
import { appendHistory, moveHistory } from '../../lib/input-history'
import { cn } from '../../lib/utils'

const HISTORY_STORAGE_KEY = 'rcs:input-history'

function loadHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

interface ChatInputProps {
  /** May reject; on rejection the draft is kept so the user can retry. */
  onSubmit: (text: string) => Promise<void> | void
  onInterrupt?: () => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
  /** Bridge-safe slash commands from `system/init`; empty hides the menu. */
  commands?: string[]
  className?: string
}

export function ChatInput({
  onSubmit,
  onInterrupt,
  isLoading = false,
  disabled = false,
  placeholder,
  commands = [],
  className,
}: ChatInputProps) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Slash menu: `dismissed` survives until the text changes again, so Esc and
  // an accepted command keep the list closed without extra bookkeeping.
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  // Prompt recall: index into `history`, or null while editing the draft.
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const historyDraftRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
    } catch {
      // Private mode and quota errors just disable persistence.
    }
  }, [history])

  const query = menuDismissed ? null : commandQuery(text)
  const items = query === null ? [] : filterCommands(commands, query)
  const menuOpen = !disabled && query !== null && commands.length > 0
  const activeIndex = items.length === 0 ? 0 : Math.min(menuIndex, items.length - 1)

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || sending) return
    setSending(true)
    try {
      await onSubmit(trimmed)
      // Only clear once the send resolved; a failure keeps the text so the
      // user can retry (the parent surfaces the error).
      setText('')
      setHistory((prev) => appendHistory(prev, trimmed))
      setHistoryIndex(null)
      historyDraftRef.current = ''
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
    setMenuDismissed(false)
    setMenuIndex(0)
    setHistoryIndex(null)
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }, [])

  /** Writes a recalled entry into the textarea and keeps its height in sync. */
  const recall = useCallback((next: { index: number | null; text: string }) => {
    setText(next.text)
    setHistoryIndex(next.index)
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    const end = next.text.length
    requestAnimationFrame(() => el.setSelectionRange(end, end))
  }, [])

  const accept = useCallback((name: string) => {
    const next = acceptCommand(name)
    setText(next)
    setMenuIndex(0)
    setMenuDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.length, next.length)
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    })
  }, [])

  const canSend = text.trim().length > 0 && !disabled && !sending
  const resolvedPlaceholder = placeholder ?? t('placeholder', { product: tCommon('claude') })

  return (
    <div className={cn('relative mx-auto w-full max-w-3xl', className)}>
      {menuOpen ? (
        <div
          id="slash-command-menu"
          data-testid="slash-command-menu"
          role="listbox"
          aria-label={t('commandMenu.label')}
          className="absolute right-0 bottom-full left-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1 shadow-md"
        >
          {items.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-muted">{t('commandMenu.empty')}</div>
          ) : (
            items.map((item, index) => (
              <button
                key={item}
                id={`slash-command-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-testid="slash-command-option"
                // Keep focus in the textarea; onClick would blur first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  accept(item)
                }}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors',
                  index === activeIndex ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-surface-2',
                )}
              >
                /{item.replace(/^\//, '')}
              </button>
            ))
          )}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2 transition-all focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(201,100,66,0.15)]">
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target)}
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'slash-command-menu' : undefined}
            aria-activedescendant={menuOpen && items.length > 0 ? `slash-command-${activeIndex}` : undefined}
            aria-autocomplete="list"
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing
              // While the menu is open it owns the navigation keys; everything
              // else (including IME composition) falls through to the composer.
              if (menuOpen && !composing) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setMenuIndex(moveIndex(activeIndex, event.key === 'ArrowDown' ? 1 : -1, items.length))
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMenuDismissed(true)
                  return
                }
                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                  const item = items[activeIndex]
                  if (item) {
                    event.preventDefault()
                    accept(item)
                    return
                  }
                }
              }
              // ArrowUp/Down recall prompts like the TUI: up starts from the
              // newest entry when the caret is on the first line (or while
              // already navigating); down walks forward and restores the draft.
              const recalling = historyIndex !== null
              const beforeCaret = text.slice(0, event.currentTarget.selectionStart)
              const onFirstLine = !beforeCaret.includes('\n')
              if (event.key === 'ArrowUp' && (onFirstLine || recalling)) {
                const moved = moveHistory(history, historyIndex, -1, historyDraftRef.current)
                if (moved) {
                  if (!recalling) historyDraftRef.current = text
                  event.preventDefault()
                  recall(moved)
                  return
                }
              }
              if (event.key === 'ArrowDown' && recalling) {
                const moved = moveHistory(history, historyIndex, 1, historyDraftRef.current)
                if (moved) {
                  event.preventDefault()
                  recall(moved)
                  return
                }
              }
              const action = resolveComposerKey({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: composing,
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
