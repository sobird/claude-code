'use client'

/**
 * Chat composer. Enter sends (mid-turn messages are queued by the CLI), Shift+Enter
 * inserts a newline, and Escape/Stop interrupt while the agent is running.
 */

import { ImagePlus, Loader2, Send, Square, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentRef } from '../../lib/attachments'
import { isImageFile, prepareImageFile } from '../../lib/attachments-client'
import { acceptCommand, commandQuery, filterCommands, moveIndex } from '../../lib/command-menu'
import { resolveComposerKey } from '../../lib/composer-keys'
import { appendHistory, moveHistory } from '../../lib/input-history'
import { randomUuid } from '../../lib/random-uuid'
import { cn } from '../../lib/utils'

const HISTORY_STORAGE_KEY = 'rcs:input-history'
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'

/** An image staged in the composer, from paste or the file picker. */
interface PendingImage {
  key: string
  previewUrl: string
  status: 'uploading' | 'ready' | 'error'
  ref?: AttachmentRef
}

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
  onSubmit: (text: string, attachments: AttachmentRef[]) => Promise<void> | void
  /** Uploads one prepared image and resolves its stored reference. */
  uploadImage?: (file: Blob) => Promise<AttachmentRef>
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
  uploadImage,
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Images live in both state (render) and a ref (synchronous reads during a
  // paste and on unmount); `commitImages` keeps the two in lockstep.
  const [images, setImages] = useState<PendingImage[]>([])
  const imagesRef = useRef<PendingImage[]>([])

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
    } catch {
      // Private mode and quota errors just disable persistence.
    }
  }, [history])

  const commitImages = useCallback((update: (prev: PendingImage[]) => PendingImage[]) => {
    const next = update(imagesRef.current)
    imagesRef.current = next
    setImages(next)
  }, [])

  // Object URLs outlive the component unless revoked; drop them on unmount.
  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl)
    },
    [],
  )

  /** Stages pasted or picked images, then uploads each and fills in its ref. */
  const addFiles = useCallback(
    (files: File[]) => {
      if (!uploadImage) return
      const candidates = files.filter(isImageFile)
      if (candidates.length === 0) return
      const room = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - imagesRef.current.length)
      const staged = candidates.slice(0, room).map((file) => ({
        file,
        key: randomUuid(),
        previewUrl: URL.createObjectURL(file),
      }))
      if (staged.length === 0) return

      commitImages((prev) => [
        ...prev,
        ...staged.map(({ key, previewUrl }) => ({ key, previewUrl, status: 'uploading' as const })),
      ])
      for (const { file, key } of staged) {
        void (async () => {
          try {
            const ref = await uploadImage(await prepareImageFile(file))
            commitImages((prev) =>
              prev.map((image) => (image.key === key ? { ...image, status: 'ready', ref } : image)),
            )
          } catch {
            commitImages((prev) => prev.map((image) => (image.key === key ? { ...image, status: 'error' } : image)))
          }
        })()
      }
    },
    [commitImages, uploadImage],
  )

  const removeImage = useCallback(
    (key: string) => {
      const target = imagesRef.current.find((image) => image.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      commitImages((prev) => prev.filter((image) => image.key !== key))
    },
    [commitImages],
  )

  const query = menuDismissed ? null : commandQuery(text)
  const items = query === null ? [] : filterCommands(commands, query)
  const menuOpen = !disabled && query !== null && commands.length > 0
  const activeIndex = items.length === 0 ? 0 : Math.min(menuIndex, items.length - 1)

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    const attachments = imagesRef.current.flatMap((image) => (image.status === 'ready' && image.ref ? [image.ref] : []))
    const uploading = imagesRef.current.some((image) => image.status === 'uploading')
    if ((!trimmed && attachments.length === 0) || disabled || sending || uploading) return
    setSending(true)
    try {
      await onSubmit(trimmed, attachments)
      // Only clear once the send resolved; a failure keeps the draft so the
      // user can retry (the parent surfaces the error).
      setText('')
      if (trimmed) {
        setHistory((prev) => appendHistory(prev, trimmed))
        setHistoryIndex(null)
        historyDraftRef.current = ''
      }
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl)
      commitImages(() => [])
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch {
      // Keep the draft; the parent already shows the error.
    } finally {
      setSending(false)
    }
  }, [text, disabled, sending, onSubmit, commitImages])

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

  const uploading = images.some((image) => image.status === 'uploading')
  const hasReadyImage = images.some((image) => image.status === 'ready')
  const canSend = (text.trim().length > 0 || hasReadyImage) && !disabled && !sending && !uploading
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
        {images.length > 0 ? (
          <div
            data-testid="attachment-strip"
            className="flex flex-wrap gap-2 border-b border-border/60 px-3 pt-2.5 pb-1.5"
          >
            {images.map((image) => (
              <div
                key={image.key}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-surface-1"
              >
                <img src={image.previewUrl} alt={t('imageAlt')} className="h-full w-full object-cover" />
                {image.status === 'uploading' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden="true" />
                  </div>
                ) : null}
                {image.status === 'error' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-1 text-center text-[10px] leading-tight text-white">
                    {t('uploadFailed')}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeImage(image.key)}
                  aria-label={t('removeImage')}
                  title={t('removeImage')}
                  data-testid="attachment-remove"
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target)}
            onPaste={(event) => {
              const files = [...event.clipboardData.files]
              if (!files.some(isImageFile)) return
              // Images are attached, not pasted as text; the text part of the
              // clipboard (if any) is dropped rather than left in the draft.
              event.preventDefault()
              addFiles(files)
            }}
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
          {uploadImage && !disabled ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                multiple
                data-testid="attachment-input"
                className="hidden"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  // Reset so picking the same file twice still fires onChange.
                  event.target.value = ''
                  addFiles(files)
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={images.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                aria-label={t('addImages')}
                title={t('addImages')}
                data-testid="attach-image"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
            </>
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
