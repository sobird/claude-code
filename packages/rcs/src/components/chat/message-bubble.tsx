'use client'

/**
 * Conversation bubbles. Ported from the legacy Vite UI and adapted to the
 * reducer's `UserMessageEntry` / `AssistantMessageEntry` model.
 */

import { Check, ChevronDown, Clock, Copy, Pencil, RotateCcw, Send, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { useAttachmentUrl } from '../../hooks/useAttachmentUrl'
import { useSmoothText } from '../../hooks/useSmoothText'
import type { AttachmentRef } from '../../lib/attachments'
import { resolveEditKey } from '../../lib/composer-keys'
import { assistantCopyText } from '../../lib/copy-text'
import type { AssistantMessageEntry, UserMessageEntry } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'
import { MarkdownText, usePacedText } from './markdown'

// Collapsed user-message height (px) before the "expand" affordance appears.
const COLLAPSED_MAX_HEIGHT = 200

const ACTION_BUTTON_CLASS =
  'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60'

/** Right-aligned user message with brand-tinted bubble and collapse-on-overflow. */
export function UserBubble({
  entry,
  editing = false,
  onStartEdit,
  onCancelEdit,
  onEdit,
}: {
  entry: UserMessageEntry
  /** Parent-owned so at most one bubble is being edited at a time. */
  editing?: boolean
  onStartEdit?: () => void
  /** Leaves edit mode (cancel or after a successful send). */
  onCancelEdit?: () => void
  /** Sends the edited text as a new turn; the original message is kept. */
  onEdit?: (text: string) => Promise<void> | void
}) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const checkOverflow = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    setOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 4)
  }, [])

  useEffect(() => {
    checkOverflow()
  }, [checkOverflow, entry.content])

  const resizeEditor = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COLLAPSED_MAX_HEIGHT)}px`
  }, [])

  // Entering edit mode refills the draft from the saved text and focuses the
  // caret at the end; switching between bubbles resets the draft the same way.
  useEffect(() => {
    if (!editing) return
    setDraft(entry.content)
    setSending(false)
    requestAnimationFrame(() => {
      const el = editorRef.current
      if (!el) return
      el.focus()
      resizeEditor(el)
      const end = entry.content.length
      el.setSelectionRange(end, end)
    })
  }, [editing, entry.content, resizeEditor])

  const submitEdit = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await onEdit?.(trimmed)
      onCancelEdit?.()
    } catch {
      // Keep the editor open; the parent's retry card reports the failure.
    } finally {
      setSending(false)
    }
  }, [draft, onCancelEdit, onEdit, sending])

  const canSend = draft.trim().length > 0 && !sending

  // While editing, the bubble becomes a composer-shaped field that spans the
  // chat column, so long prompts are easy to revise on a phone.
  return (
    <div className={editing ? 'flex w-full' : 'flex justify-end'}>
      <div className={cn('group/bubble', editing ? 'w-full' : 'max-w-[85%] sm:max-w-[70%]')}>
        {editing ? (
          <div className="overflow-hidden rounded-xl border border-user-bubble transition-colors focus-within:border-brand">
            <div className="flex items-end gap-2 px-3 py-2.5">
              <textarea
                ref={editorRef}
                data-testid="edit-message-input"
                value={draft}
                aria-label={t('edit')}
                rows={1}
                onChange={(event) => {
                  setDraft(event.target.value)
                  resizeEditor(event.target)
                }}
                onKeyDown={(event) => {
                  const action = resolveEditKey({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                  })
                  if (action === 'submit') {
                    event.preventDefault()
                    void submitEdit()
                  } else if (action === 'cancel') {
                    event.preventDefault()
                    onCancelEdit?.()
                  }
                }}
                className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-left font-display text-sm leading-normal text-text-primary outline-none"
              />
              <button
                type="button"
                onClick={onCancelEdit}
                aria-label={tCommon('cancel')}
                title={tCommon('cancel')}
                data-testid="edit-message-cancel"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="edit-message-send"
                onClick={() => void submitEdit()}
                disabled={!canSend}
                aria-label={t('send')}
                title={t('send')}
                className={cn(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-all',
                  canSend ? 'bg-brand text-white hover:bg-brand-light' : 'bg-surface-1 text-text-muted',
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : entry.attachments?.length || entry.content ? (
          <div className="flex flex-col items-end gap-2">
            {entry.attachments?.length ? (
              <div className="flex max-w-full flex-wrap justify-end gap-2">
                {entry.attachments.map((attachment) => (
                  <AttachmentThumb key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : null}
            {entry.content ? (
              <div className="relative overflow-hidden rounded-2xl rounded-br-md border border-user-bubble-border bg-user-bubble">
                <div
                  ref={contentRef}
                  className={cn(
                    'whitespace-pre-wrap px-4 py-3 font-display text-sm leading-relaxed text-white',
                    !expanded && overflowing && 'overflow-hidden',
                  )}
                  style={!expanded && overflowing ? { maxHeight: `${COLLAPSED_MAX_HEIGHT}px` } : undefined}
                >
                  {entry.content}
                </div>
                {!expanded && overflowing ? (
                  <div className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-user-bubble via-user-bubble/80 to-transparent pt-8">
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="flex items-center gap-1 rounded-full px-3 py-1 font-display text-xs font-medium text-white/90 transition-colors hover:bg-white/15"
                    >
                      <span>{t('expand')}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {!editing && (entry.queued || entry.content || entry.attachments?.length) ? (
          <div className="mt-1 flex items-center justify-end gap-2">
            {entry.queued ? (
              <span
                data-testid="queued-message"
                className="flex items-center gap-1 font-display text-[11px] text-text-muted"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                {t('queued')}
              </span>
            ) : null}
            {entry.content && onEdit ? (
              <button
                type="button"
                data-testid="edit-message"
                title={t('edit')}
                aria-label={t('edit')}
                onClick={onStartEdit}
                className={ACTION_BUTTON_CLASS}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {entry.content ? <CopyButton text={entry.content} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Square preview of a stored image. The bearer token cannot ride on `<img src>`,
 * so the hook fetches the bytes with the API client and hands back an object URL.
 * Clicking opens a full-screen overlay rather than a new tab, so the image keeps
 * the app's chrome-free viewing without leaving the transcript.
 */
function AttachmentThumb({ attachment }: { attachment: AttachmentRef }) {
  const t = useTranslations('chat')
  const url = useAttachmentUrl(attachment.id)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!url) {
    return (
      <div
        className="h-28 w-28 animate-pulse rounded-xl border border-user-bubble-border bg-surface-1 sm:h-32 sm:w-32"
        aria-hidden="true"
      />
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="message-attachment"
        aria-label={t('imageAlt')}
        className="block h-28 w-28 cursor-zoom-in overflow-hidden rounded-xl border border-user-bubble-border bg-surface-1 sm:h-32 sm:w-32"
      >
        <img src={url} alt={t('imageAlt')} loading="lazy" className="h-full w-full object-cover" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('imageAlt')}
          data-testid="attachment-lightbox"
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <img src={url} alt={t('imageAlt')} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('closeImage')}
            title={t('closeImage')}
            data-testid="attachment-lightbox-close"
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  )
}

/** Copies a message's text; the icon flips to a check for a beat afterwards. */
function CopyButton({ text }: { text: string }) {
  const t = useTranslations('chat')
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied; the text stays selectable by hand.
    }
  }

  return (
    <button
      type="button"
      data-testid="copy-message"
      title={t('copy')}
      aria-label={t('copy')}
      onClick={() => void copy()}
      className={ACTION_BUTTON_CLASS}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="sr-only">{copied ? t('copied') : t('copy')}</span>
    </button>
  )
}

/** Left-aligned assistant message with the Anthropic mark and editable prose. */
export function AssistantBubble({
  entry,
  canRegenerate = false,
  onRegenerate,
}: {
  entry: AssistantMessageEntry
  /** Only the latest completed reply offers this; it resends the last prompt. */
  canRegenerate?: boolean
  onRegenerate?: () => Promise<void> | void
}) {
  const tCommon = useTranslations('common')
  const copyText = entry.streaming ? '' : assistantCopyText(entry.chunks)
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10">
        <ClaudeMark />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <span className="font-display text-sm font-semibold text-text-primary">{tCommon('claude')}</span>
        {entry.chunks.map((chunk, index) => {
          // Stable keys: the active chunk's text grows on every delta, and a
          // text-derived key would remount the node (and restart the reveal) each
          // time. Chunks are only appended, so the index is stable.
          const key = `chunk-${index}`
          if (chunk.type === 'thought') {
            return <ThoughtBlock key={key} content={entry.streaming ? <SmoothText text={chunk.text} /> : chunk.text} />
          }
          return entry.streaming ? (
            <StreamingMarkdown key={key} text={chunk.text} />
          ) : (
            <MarkdownText key={key} text={chunk.text} />
          )
        })}
        {copyText || (canRegenerate && onRegenerate) ? (
          <div className="flex items-center gap-1">
            {copyText ? <CopyButton text={copyText} /> : null}
            {canRegenerate && onRegenerate ? <RegenerateButton onRegenerate={onRegenerate} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Resends the last prompt as a new turn. The CLI cannot rewind, so the
 * previous reply stays in the transcript.
 */
function RegenerateButton({ onRegenerate }: { onRegenerate: () => Promise<void> | void }) {
  const t = useTranslations('chat')
  const [pending, setPending] = useState(false)
  const run = async () => {
    setPending(true)
    try {
      await onRegenerate()
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      type="button"
      data-testid="regenerate-message"
      title={t('regenerate')}
      aria-label={t('regenerate')}
      disabled={pending}
      onClick={() => void run()}
      className={ACTION_BUTTON_CLASS}
    >
      <RotateCcw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} />
    </button>
  )
}

function ThoughtBlock({ content }: { content: ReactNode }) {
  const t = useTranslations('chat')
  return (
    <details className="group rounded-lg border border-border bg-surface-1/60 px-3 py-2">
      <summary className="cursor-pointer list-none font-display text-xs font-medium text-text-muted transition-colors hover:text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          {t('thought')}
        </span>
      </summary>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">{content}</div>
    </details>
  )
}

/** Streams its text in progressively; used for collapsed thought blocks. */
function SmoothText({ text }: { text: string }) {
  return <>{useSmoothText(text)}</>
}

/** Live markdown: the smooth reveal drives the text, pacing caps re-parses. */
function StreamingMarkdown({ text }: { text: string }) {
  const smoothed = useSmoothText(text)
  const paced = usePacedText(smoothed, 80)
  return <MarkdownText text={paced} streaming />
}

function ClaudeMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="var(--color-brand)"
        fillRule="nonzero"
      />
    </svg>
  )
}
