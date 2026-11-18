'use client'

/**
 * Chat composer. Enter sends (mid-turn messages are queued by the CLI), Shift+Enter
 * inserts a newline, and Escape/Stop interrupt while the agent is running.
 */

import { ImagePlus, Loader2, MessageCircleQuestion, Send, Square, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type DragEvent as ReactDragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentRef } from '../../lib/attachments'
import { isImageFile, prepareImageFile } from '../../lib/attachments-client'
import { acceptCommand, commandQuery, filterCommands, moveIndex } from '../../lib/command-menu'
import { resolveComposerKey } from '../../lib/composer-keys'
import { applyFileSuggestion, fileQuery, type FileQueryToken } from '../../lib/file-completion'
import { type HistoryMatch, searchHistory } from '../../lib/history-search'
import { appendHistory, moveHistory } from '../../lib/input-history'
import { randomUuid } from '../../lib/random-uuid'
import { isBtwCommand, parseBtwCommand } from '../../lib/side-question'
import { cn } from '../../lib/utils'

const HISTORY_STORAGE_KEY = 'rcs:input-history'
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'
// Typing pauses shorter than this skip the round-trip to the bridge.
const FILE_COMPLETION_DEBOUNCE_MS = 120

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
  /**
   * Sends a `/btw <question>` aside instead of a normal turn. Absent leaves the
   * command to go out as plain text (the CLI swallows it in headless mode).
   */
  onSideQuestion?: (question: string) => Promise<void> | void
  /** Uploads one prepared image and resolves its stored reference. */
  uploadImage?: (file: Blob) => Promise<AttachmentRef>
  onInterrupt?: () => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
  /** Bridge-safe slash commands from `system/init`; empty hides the menu. */
  commands?: string[]
  /** Fetches `@` file completion for a path fragment; absent disables the menu. */
  fileSuggestions?: (query: string) => Promise<string[]>
  /** Cycles the permission mode on Shift+Tab; absent leaves the shortcut to the browser. */
  onCyclePermissionMode?: () => void
  className?: string
}

export function ChatInput({
  onSubmit,
  onSideQuestion,
  uploadImage,
  onInterrupt,
  isLoading = false,
  disabled = false,
  placeholder,
  commands = [],
  fileSuggestions,
  onCyclePermissionMode,
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
  // `@` completion: the token under the caret (null closes the menu) and its
  // fetched paths. Dismissal behaves like the slash menu's.
  const [fileToken, setFileToken] = useState<FileQueryToken | null>(null)
  const [fileItems, setFileItems] = useState<string[]>([])
  const [fileIndex, setFileIndex] = useState(0)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileDismissed, setFileDismissed] = useState(false)
  // Prompt recall: index into `history`, or null while editing the draft.
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const historyDraftRef = useRef('')
  // Ctrl+R prompt search: a dedicated input over the same history list.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Drag-and-drop target highlight while files hover the composer.
  const [dragging, setDragging] = useState(false)
  const dragDepthRef = useRef(0)
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

  const fileQueryText = fileToken?.query ?? null
  const fileMenuActive = Boolean(fileSuggestions) && fileQueryText !== null && !fileDismissed
  useEffect(() => {
    if (!fileMenuActive || fileQueryText === null || !fileSuggestions) {
      setFileItems([])
      setFileLoading(false)
      return
    }
    let cancelled = false
    setFileLoading(true)
    const timer = setTimeout(() => {
      fileSuggestions(fileQueryText)
        .then((paths) => {
          if (cancelled) return
          setFileItems(paths)
          setFileIndex(0)
        })
        .catch(() => {
          if (!cancelled) setFileItems([])
        })
        .finally(() => {
          if (!cancelled) setFileLoading(false)
        })
    }, FILE_COMPLETION_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fileMenuActive, fileQueryText, fileSuggestions])

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

  const searchMatches = useMemo(
    () => (searchOpen ? searchHistory(history, searchQuery) : []),
    [searchOpen, history, searchQuery],
  )
  const activeSearchIndex = searchMatches.length === 0 ? 0 : Math.min(searchIndex, searchMatches.length - 1)

  /** Closes the search overlay and returns focus to the composer. */
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  /** Writes a searched history entry into the textarea without sending it. */
  const acceptSearchMatch = useCallback((match: HistoryMatch) => {
    setText(match.text)
    setSearchOpen(false)
    setSearchQuery('')
    setFileToken(null)
    setFileItems([])
    setHistoryIndex(null)
    historyDraftRef.current = ''
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
      el.setSelectionRange(match.text.length, match.text.length)
    })
  }, [])

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
  const fileMenuOpen = !disabled && fileMenuActive
  const activeFileIndex = fileItems.length === 0 ? 0 : Math.min(fileIndex, fileItems.length - 1)
  const activeDescendant =
    menuOpen && items.length > 0
      ? `slash-command-${activeIndex}`
      : fileMenuOpen && fileItems.length > 0
        ? `file-completion-${activeFileIndex}`
        : undefined
  const controlsId = menuOpen ? 'slash-command-menu' : fileMenuOpen ? 'file-completion-menu' : undefined

  /** Points the completion menu at the `@` token under the caret, if any. */
  const syncFileToken = useCallback(
    (value: string, caret: number) => {
      if (!fileSuggestions) return
      setFileToken(fileQuery(value, caret))
      setFileIndex(0)
      setFileDismissed(false)
    },
    [fileSuggestions],
  )

  const acceptFile = useCallback(
    (path: string) => {
      if (!fileToken) return
      const current = textareaRef.current?.value ?? text
      const next = applyFileSuggestion(current, fileToken, path)
      setText(next.text)
      setFileToken(null)
      setFileItems([])
      setFileDismissed(true)
      setHistoryIndex(null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(next.caret, next.caret)
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`
      })
    },
    [fileToken, text],
  )

  // `/btw` asides bypass the transcript: the question goes to the side-question
  // route and the answer lands in a transient card.
  const btwMode = onSideQuestion !== undefined && isBtwCommand(text)

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    const attachments = imagesRef.current.flatMap((image) => (image.status === 'ready' && image.ref ? [image.ref] : []))
    const uploading = imagesRef.current.some((image) => image.status === 'uploading')
    if (disabled || sending || uploading) return
    // A bare `/btw` has no question yet; keep the draft so the user can finish it.
    if (onSideQuestion !== undefined && isBtwCommand(trimmed) && parseBtwCommand(trimmed) === null) return
    if (!trimmed && attachments.length === 0) return
    const aside = onSideQuestion !== undefined ? parseBtwCommand(trimmed) : null
    setSending(true)
    try {
      if (aside !== null && onSideQuestion !== undefined) {
        await onSideQuestion(aside)
      } else {
        await onSubmit(trimmed, attachments)
      }
      // Only clear once the send resolved; a failure keeps the draft so the
      // user can retry (the parent surfaces the error).
      setText('')
      setFileToken(null)
      setFileItems([])
      setSearchOpen(false)
      setSearchQuery('')
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
  }, [text, disabled, sending, onSubmit, onSideQuestion, commitImages])

  const handleInput = useCallback(
    (target: HTMLTextAreaElement) => {
      setText(target.value)
      setMenuDismissed(false)
      setMenuIndex(0)
      setHistoryIndex(null)
      syncFileToken(target.value, target.selectionStart ?? target.value.length)
      target.style.height = 'auto'
      target.style.height = `${Math.min(target.scrollHeight, 200)}px`
    },
    [syncFileToken],
  )

  /** Writes a recalled entry into the textarea and keeps its height in sync. */
  const recall = useCallback((next: { index: number | null; text: string }) => {
    setText(next.text)
    setFileToken(null)
    setFileItems([])
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
    setFileToken(null)
    setFileItems([])
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

  // Dragging is only meaningful when attachments are accepted (images, editable session).
  const dropEnabled = Boolean(uploadImage) && !disabled
  const hasFiles = (event: ReactDragEvent<HTMLDivElement>): boolean => [...event.dataTransfer.types].includes('Files')
  const dragHandlers = dropEnabled
    ? {
        onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          dragDepthRef.current += 1
          setDragging(true)
        },
        onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          // Child nodes fire enter/leave as the pointer moves; count depth to
          // avoid flickering the highlight.
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setDragging(false)
        },
        onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          dragDepthRef.current = 0
          setDragging(false)
          addFiles([...event.dataTransfer.files])
        },
      }
    : {}

  const uploading = images.some((image) => image.status === 'uploading')
  const hasReadyImage = images.some((image) => image.status === 'ready')
  const canSend = (text.trim().length > 0 || hasReadyImage) && !disabled && !sending && !uploading
  const resolvedPlaceholder = placeholder ?? t('placeholder', { product: tCommon('claude') })

  return (
    <div
      className={cn('relative mx-auto w-full max-w-3xl', className)}
      data-testid="composer-drop-target"
      {...dragHandlers}
    >
      {searchOpen ? (
        <div
          data-testid="history-search-menu"
          role="dialog"
          aria-label={t('historyMenu.label')}
          className="absolute right-0 bottom-full left-0 z-30 mb-1 rounded-lg border border-border bg-surface-1 p-2 shadow-md"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setSearchIndex(0)
            }}
            onKeyDown={(event) => {
              // The overlay owns these keys; keep document-level shortcuts out.
              event.stopPropagation()
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (searchMatches.length > 0) {
                  setSearchIndex(moveIndex(activeSearchIndex, event.key === 'ArrowDown' ? 1 : -1, searchMatches.length))
                }
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const match = searchMatches[activeSearchIndex]
                if (match) acceptSearchMatch(match)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              }
            }}
            placeholder={t('historyMenu.placeholder')}
            aria-label={t('historyMenu.label')}
            data-testid="history-search-input"
            className="mb-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand/50"
          />
          {searchMatches.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-muted">{t('historyMenu.empty')}</div>
          ) : (
            <div role="listbox" aria-label={t('historyMenu.label')} className="max-h-56 overflow-y-auto">
              {searchMatches.map((match, index) => (
                <button
                  key={`${match.index}-${match.text}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSearchIndex}
                  data-testid="history-search-option"
                  title={match.text}
                  // Keep focus in the search input; onClick would blur first.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    acceptSearchMatch(match)
                  }}
                  className={cn(
                    'flex w-full items-center truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    index === activeSearchIndex ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-surface-2',
                  )}
                >
                  {match.text}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {menuOpen && !searchOpen ? (
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
      {fileMenuOpen && !searchOpen ? (
        <div
          id="file-completion-menu"
          data-testid="file-completion-menu"
          role="listbox"
          aria-label={t('fileMenu.label')}
          className="absolute right-0 bottom-full left-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1 shadow-md"
        >
          {fileItems.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-muted">
              {fileLoading ? t('fileMenu.loading') : t('fileMenu.empty')}
            </div>
          ) : (
            fileItems.map((path, index) => (
              <button
                key={path}
                id={`file-completion-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeFileIndex}
                data-testid="file-completion-option"
                title={path}
                // Keep focus in the textarea; onClick would blur first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  acceptFile(path)
                }}
                className={cn(
                  'flex w-full items-center truncate rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors',
                  index === activeFileIndex ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-surface-2',
                )}
              >
                {path}
              </button>
            ))
          )}
        </div>
      ) : null}
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-border bg-surface-2 transition-all focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(201,100,66,0.15)]',
          dragging && 'ring-2 ring-brand/40',
        )}
      >
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
        {btwMode ? (
          <div
            data-testid="btw-badge"
            className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[11px] text-brand"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span className="font-display font-medium">{t('sideQuestion.badge')}</span>
            <span className="truncate text-text-muted">{t('sideQuestion.hint')}</span>
          </div>
        ) : null}
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target)}
            // Moving the caret (arrows, click, home/end) retargets the `@` menu
            // without reopening one the user dismissed.
            onSelect={(event) => {
              if (!fileSuggestions) return
              const el = event.currentTarget
              setFileToken(fileQuery(el.value, el.selectionStart ?? el.value.length))
              setFileIndex(0)
            }}
            onFocus={() => {
              // Clicking back into the composer dismisses the search overlay.
              if (searchOpen) setSearchOpen(false)
            }}
            onPaste={(event) => {
              const files = [...event.clipboardData.files]
              if (!files.some(isImageFile)) return
              // Images are attached, not pasted as text; the text part of the
              // clipboard (if any) is dropped rather than left in the draft.
              event.preventDefault()
              addFiles(files)
            }}
            role="combobox"
            aria-expanded={menuOpen || fileMenuOpen}
            aria-controls={controlsId}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing
              // Shift+Tab cycles the permission mode (a global TUI key); menus do
              // not swallow it while they are open.
              if (!composing && event.key === 'Tab' && event.shiftKey && onCyclePermissionMode) {
                event.preventDefault()
                onCyclePermissionMode()
                return
              }
              // Ctrl+R opens prompt-history search. Cmd+R stays the browser's reload.
              if (
                !composing &&
                !disabled &&
                event.key.toLowerCase() === 'r' &&
                event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.shiftKey
              ) {
                event.preventDefault()
                setSearchQuery('')
                setSearchIndex(0)
                setSearchOpen(true)
                requestAnimationFrame(() => searchInputRef.current?.focus())
                return
              }
              // `@` completion owns the navigation keys while it has results; an
              // empty or still-loading list lets Enter submit as usual.
              if (fileMenuOpen && fileItems.length > 0 && !composing) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setFileIndex(moveIndex(activeFileIndex, event.key === 'ArrowDown' ? 1 : -1, fileItems.length))
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFileDismissed(true)
                  return
                }
                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                  const path = fileItems[activeFileIndex]
                  if (path) {
                    event.preventDefault()
                    acceptFile(path)
                    return
                  }
                }
              }
              // While the slash menu is open it owns the navigation keys; everything
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
