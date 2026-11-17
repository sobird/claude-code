'use client'

/**
 * Session detail chat surface.
 *
 * Loads durable history once with the token-aware client, folds it together
 * with the live SSE frames (deduped by `seqNum`) through the pure reducer, and
 * renders the thread, permission cards, and composer. A sent message is folded
 * in from its `POST /events` response (deduped by seqNum/uuid against the live
 * echo and history) so it shows immediately and survives a reload.
 */

import { ArrowDown, ArrowLeft, Gauge, Keyboard, Loader2, Timer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { isSessionClosedStatus } from '../../contracts'
import { useAccessToken } from '../../hooks/useAccessToken'
import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { useSessionStream } from '../../hooks/useSessionStream'
import { createApiClient } from '../../lib/api-client'
import { withPendingApprovalCount } from '../../lib/approval-alert'
import { buildUserContent, type AttachmentRef } from '../../lib/attachments'
import { latestPrompt } from '../../lib/message-actions'
import { earlierStartIndex, windowStartIndex } from '../../lib/message-window'
import { buildSetPermissionModeRequest, type WebPermissionMode } from '../../lib/permission-modes'
import type { PermissionDecision } from '../../lib/permission-suggestions'
import { randomUuid } from '../../lib/random-uuid'
import {
  activeStreamEvents,
  applyHistory,
  initialChatState,
  isEphemeralEvent,
  type SessionEventInput,
  type ThreadEntry,
  type ToolCallEntry,
  type TurnEndEntry,
} from '../../lib/session-reducer'
import { isHelpShortcut } from '../../lib/shortcut-help'
import { formatTokenCount, promptTokens } from '../../lib/token-usage'
import { formatTurnSeconds } from '../../lib/turn-duration'
import { cn, uniqueKeys } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import { Button } from '../ui/button'
import { ChatInput } from './chat-input'
import { AssistantBubble, UserBubble } from './message-bubble'
import { PermissionModeMenu } from './permission-mode-menu'
import { PermissionPanel } from './permission-panel'
import { PlanView } from './plan-view'
import { ShortcutsDialog } from './shortcuts-dialog'
import { TaskPanel } from './task-panel'
import { ToolCallGroup } from './tool-call-group'

interface SessionDetail {
  id: string
  title: string | null
  status: string
  owner_user_id: string | null
}

interface HistoryEvent {
  id: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  seqNum: number
  createdAt: number
}

interface HistoryResponse {
  events: HistoryEvent[]
  nextBefore: number | null
}

interface EventActionResponse {
  status: string
  event?: SessionEventInput
}

type GroupedItem =
  | { kind: 'entry'; entry: Exclude<ThreadEntry, ToolCallEntry> }
  | { kind: 'tools'; entries: ToolCallEntry[] }

function groupToolCalls(entries: ThreadEntry[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let tools: ToolCallEntry[] = []

  const flush = () => {
    if (tools.length > 0) result.push({ kind: 'tools', entries: tools })
    tools = []
  }

  for (const entry of entries) {
    if (entry.type === 'tool_call') {
      tools.push(entry)
    } else {
      flush()
      result.push({ kind: 'entry', entry })
    }
  }
  flush()
  return result
}

interface KeyedItem {
  item: GroupedItem
  key: string
}

function itemKey(item: GroupedItem): string {
  // Tool groups are keyed by their newest call: when an older page merges a
  // call into a group's front, the group keeps its key and a pinned window
  // stays put. Keying by the first call would make the pin go stale there.
  return item.kind === 'tools'
    ? `tools-${item.entries[item.entries.length - 1]?.toolCall.id ?? 'empty'}`
    : `entry-${item.entry.id}`
}

// Scrolling within this many pixels of the top reveals/fetches older items, so
// history pages in as the reader scrolls back instead of behind a button.
const AUTO_LOAD_TOP_PX = 160

/** The rendered node for a transcript item, used to anchor scroll on reveal. */
function findMessageNode(el: HTMLElement, key: string): HTMLElement | null {
  for (const node of el.querySelectorAll<HTMLElement>('[data-message-key]')) {
    if (node.dataset.messageKey === key) return node
  }
  return null
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const t = useTranslations('session.view')
  const tCommon = useTranslations('common')
  const tShortcuts = useTranslations('chat.shortcuts')
  const describeError = useApiErrorMessage()
  const { token, refresh: refreshToken, error: tokenError } = useAccessToken()
  const tokenRef = useRef(token)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const api = useMemo(() => createApiClient({ getToken: () => tokenRef.current, refreshToken }), [refreshToken])

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [history, setHistory] = useState<HistoryEvent[] | null>(null)
  // Cursor for the next older page; null once the whole history is loaded.
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  // Events folded in from a send response so the message shows immediately even
  // if the live stream hiccups; the SSE echo dedupes by seqNum/uuid.
  const [extraEvents, setExtraEvents] = useState<SessionEventInput[]>([])
  const [failedSend, setFailedSend] = useState<{
    text: string
    attachments: AttachmentRef[]
    uuid: string
    error: unknown
  } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  // First rendered item, pinned by key so appends never unmount what is on
  // screen and prepended pages resolve to the same item. Null until history
  // lands, so the initial view is the newest window of the loaded transcript.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  // Pinned node's viewport top captured before a reveal; the layout effect
  // restores it after the older items mount.
  const revealAnchorRef = useRef<{ key: string; top: number } | null>(null)
  // A server page that arrives with older events is followed by one local
  // reveal so the click always shows something new.
  const revealAfterLoadRef = useRef(false)
  // Keeps the reveal anchor pinned through async reflow (the thread content
  // resizes when a lazily-loaded markdown chunk replaces its plain-text
  // fallback). See the anchoring layout effect; bounded by a short timer.
  const settleRef = useRef<{ observer: ResizeObserver; timer: ReturnType<typeof setTimeout> } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // `?` opens the shortcut reference wherever the user is not typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true
      const open = isHelpShortcut({
        key: event.key,
        inEditable,
        hasModifier: event.metaKey || event.ctrlKey || event.altKey,
        isComposing: event.isComposing,
      })
      if (!open) return
      event.preventDefault()
      setShortcutsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const hasToken = token !== null
  const stream = useSessionStream(sessionId)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const path = `/web/sessions/${encodeURIComponent(sessionId)}`
      const [detail, page] = await Promise.all([
        api.get<SessionDetail>(path),
        api.get<HistoryResponse>(`${path}/history?limit=100`),
      ])
      setSession(detail)
      setHistory(Array.isArray(page.events) ? page.events : [])
      setNextBefore(typeof page.nextBefore === 'number' ? page.nextBefore : null)
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [api, sessionId])

  useEffect(() => {
    if (!hasToken) return
    void load()
  }, [hasToken, load])

  // `@` completion is best-effort: failures and malformed payloads fall back to
  // an empty list so the composer never blocks on the bridge.
  const suggestFiles = useCallback(
    async (query: string): Promise<string[]> => {
      const res = await api.get<{ suggestions?: unknown }>(
        `/web/sessions/${encodeURIComponent(sessionId)}/file-suggestions?q=${encodeURIComponent(query)}`,
      )
      const suggestions = res?.suggestions
      return Array.isArray(suggestions) ? suggestions.filter((path): path is string => typeof path === 'string') : []
    },
    [api, sessionId],
  )

  const loadEarlier = useCallback(async () => {
    if (nextBefore === null || loadingEarlier) return
    const path = `/web/sessions/${encodeURIComponent(sessionId)}`
    setLoadingEarlier(true)
    try {
      const page = await api.get<HistoryResponse>(`${path}/history?limit=100&before=${nextBefore}`)
      const older = Array.isArray(page.events) ? page.events : []
      if (older.length > 0) revealAfterLoadRef.current = true
      setHistory((prev) => {
        const merged = new Map<number, HistoryEvent>()
        for (const event of [...older, ...(prev ?? [])]) {
          if (!merged.has(event.seqNum)) merged.set(event.seqNum, event)
        }
        return [...merged.values()].toSorted((a, b) => a.seqNum - b.seqNum)
      })
      setNextBefore(typeof page.nextBefore === 'number' ? page.nextBefore : null)
    } catch (error) {
      setActionError(error)
    } finally {
      setLoadingEarlier(false)
    }
  }, [api, sessionId, nextBefore, loadingEarlier])

  // Fold durable events first (history, live frames, locally-sent events) in
  // sequence order so an assistant reply never lands before its prompt. Streamed
  // deltas carry no durable sequence, so they are replayed separately on top:
  // only the window after the last terminal event is still live.
  const chat = useMemo(() => {
    const merged: SessionEventInput[] = []
    for (const event of history ?? []) merged.push(event)
    for (const event of stream.events) merged.push(event)
    for (const event of extraEvents) merged.push(event)
    const durable = merged
      .filter((event) => !isEphemeralEvent(event))
      .toSorted((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0))
    const historyState = applyHistory(initialChatState, durable)
    return applyHistory(historyState, activeStreamEvents(stream.events))
  }, [history, stream.events, extraEvents])

  const entries = chat.entries
  const entryCount = entries.length
  const streaming = entries.some((entry) => entry.type === 'assistant_message' && entry.streaming)

  // Only a bounded window of grouped items is mounted; older ones are revealed
  // a chunk at a time before the server page behind them is fetched.
  const keyed = useMemo<KeyedItem[]>(() => uniqueKeys(groupToolCalls(entries), itemKey), [entries])
  const windowKeys = useMemo(() => keyed.map((item) => item.key), [keyed])
  const windowStart = windowStartIndex(windowKeys, pinnedKey)
  const visibleItems = useMemo(() => keyed.slice(windowStart), [keyed, windowStart])

  // Pin once the durable history is in, so live frames that beat the fetch do
  // not pin the window to a partial tail.
  useEffect(() => {
    if (pinnedKey !== null || !history) return
    if (windowKeys.length === 0) return
    setPinnedKey(windowKeys[windowStartIndex(windowKeys, null)])
  }, [history, pinnedKey, windowKeys])

  const revealEarlier = useCallback(() => {
    const el = scrollRef.current
    const first = windowKeys[windowStart]
    if (!el || !first || windowStart === 0) return
    const node = findMessageNode(el, first)
    if (node) revealAnchorRef.current = { key: first, top: node.getBoundingClientRect().top }
    setPinnedKey(windowKeys[earlierStartIndex(windowStart)])
  }, [windowKeys, windowStart])

  // Older items mount above the pinned one; put it back where it was so the
  // reader's place does not jump. Tail-jump and streaming follow are separate.
  //
  // A one-shot commit fix is not enough: assistant text renders as a tall
  // plain-text fallback until the lazily-loaded markdown chunk swaps in, which
  // can collapse a long message by thousands of pixels a few frames later.
  // Re-apply the anchor whenever the thread content resizes, bounded so a
  // stale correction never fights later scrolling.
  useLayoutEffect(() => {
    const anchor = revealAnchorRef.current
    const el = scrollRef.current
    revealAnchorRef.current = null
    if (!anchor || !el) return

    const place = () => {
      const node = findMessageNode(el, anchor.key)
      if (!node) return
      const delta = node.getBoundingClientRect().top - anchor.top
      if (Math.abs(delta) > 0.5) el.scrollTop += delta
    }

    place()

    // Async content (lazy markdown swapping in, fonts) can resize the thread
    // after this commit; observe it and re-anchor until the layout settles.
    // Growth below the anchor has no effect on its top, so streaming does not
    // fight this.
    if (settleRef.current !== null) {
      settleRef.current.observer.disconnect()
      clearTimeout(settleRef.current.timer)
    }
    const target = contentRef.current
    if (target) {
      const observer = new ResizeObserver(place)
      observer.observe(target)
      const timer = setTimeout(() => {
        observer.disconnect()
        settleRef.current = null
      }, 2000)
      settleRef.current = { observer, timer }
    }
  })

  // Drop the observer when the view unmounts.
  useEffect(() => {
    return () => {
      if (settleRef.current !== null) {
        settleRef.current.observer.disconnect()
        clearTimeout(settleRef.current.timer)
      }
    }
  }, [])

  useEffect(() => {
    if (!revealAfterLoadRef.current) return
    revealAfterLoadRef.current = false
    revealEarlier()
  }, [revealEarlier])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }, [])

  // Near the top of the loaded window, keep feeding older items: reveal what is
  // already loaded before fetching the next page. Runs from the scroll handler,
  // so the reader just keeps scrolling up instead of pressing a button.
  const maybeLoadEarlier = useCallback(() => {
    const el = scrollRef.current
    if (!el || el.scrollTop > AUTO_LOAD_TOP_PX) return
    if (windowStart > 0) revealEarlier()
    else if (nextBefore !== null) void loadEarlier()
  }, [revealEarlier, windowStart, nextBefore, loadEarlier])

  // Release the follow as soon as the reader scrolls up, so re-reading older
  // messages is never yanked back to the newest one.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    atBottomRef.current = near
    setAtBottom(near)
    maybeLoadEarlier()
  }, [maybeLoadEarlier])

  // When the loaded transcript is shorter than the viewport there is nothing to
  // scroll, so the handler above never fires; fetch the next page directly so a
  // short session is not stuck with unloadable history.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || loading || loadingEarlier || nextBefore === null) return
    if (el.scrollHeight > el.clientHeight + 40) return
    void loadEarlier()
  }, [loading, loadingEarlier, nextBefore, entries.length, loadEarlier])

  // New entries follow the bottom only while the reader is already there.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom()
  }, [entryCount, scrollToBottom])

  // A hidden tab shows a count in its title while approvals wait, so the user
  // knows to come back without watching the page.
  const pendingApprovalCount = chat.pendingPermissions.length
  useEffect(() => {
    const base = document.title
    let applied = false
    const sync = () => {
      const show = document.visibilityState === 'hidden' && pendingApprovalCount > 0
      if (show && !applied) {
        document.title = withPendingApprovalCount(base, pendingApprovalCount)
        applied = true
      } else if (!show && applied) {
        document.title = base
        applied = false
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      if (applied) document.title = base
    }
  }, [pendingApprovalCount])

  // While a reply streams, the text grows between reducer updates as it is
  // revealed, so follow it frame-by-frame while the reader is at the bottom.
  useEffect(() => {
    if (!streaming) return undefined
    let frame = 0
    const follow = () => {
      const el = scrollRef.current
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [streaming])

  const sendWithUuid = useCallback(
    async (text: string, uuid: string, attachments: AttachmentRef[] = []) => {
      setActionError(null)
      // Images ride as reference blocks the gateway hydrates into base64 before
      // the CLI sees them; a wire message needs `role` for the CLI normalizer.
      const blocks = attachments.length > 0 ? buildUserContent(text, attachments) : null
      const content = blocks ?? text
      const message = blocks ? { role: 'user', content: blocks } : { content: text }
      try {
        const result = await api.post<EventActionResponse>(`/web/sessions/${encodeURIComponent(sessionId)}/events`, {
          type: 'user',
          uuid,
          content,
          message,
        })
        const event = result?.event
        setExtraEvents((prev) => [
          ...prev,
          event ?? { id: uuid, type: 'user', direction: 'outbound', payload: { content, message, uuid } },
        ])
        setFailedSend(null)
        scrollToBottom()
      } catch (error) {
        setFailedSend({ text, attachments, uuid, error })
        // Rethrow so the composer keeps the draft for a retry.
        throw error
      }
    },
    [api, sessionId, scrollToBottom],
  )

  const handleSend = useCallback(
    async (text: string, attachments: AttachmentRef[]) => {
      // Generate the uuid once so the send body, the response event, a retry,
      // and a history reload all agree on the same entry id (reducer dedupes
      // by it, so a retry that the server already accepted cannot duplicate).
      await sendWithUuid(text, randomUuid(), attachments)
    },
    [sendWithUuid],
  )

  // Editing and regenerating both append a turn: the bridge cannot rewind the
  // CLI's conversation, so the previous exchange stays in the transcript.
  const latestPromptText = useMemo(() => latestPrompt(entries), [entries])

  // Rethrows on failure so the inline editor stays open for a retry.
  const handleEditMessage = useCallback(
    async (text: string) => {
      await sendWithUuid(text, randomUuid())
    },
    [sendWithUuid],
  )

  const handleRegenerate = useCallback(async () => {
    if (!latestPromptText) return
    try {
      await sendWithUuid(latestPromptText, randomUuid())
    } catch {
      // sendWithUuid surfaces failures through the retry card.
    }
  }, [latestPromptText, sendWithUuid])

  const handleRetrySend = useCallback(async () => {
    const failed = failedSend
    if (!failed) return
    try {
      await sendWithUuid(failed.text, failed.uuid, failed.attachments)
    } catch {
      // The inline card already reports the failure.
    }
  }, [failedSend, sendWithUuid])

  // Downscaled images are uploaded here, before the turn is sent, so the send
  // body only carries references and a failure never leaves a half-sent turn.
  const handleUploadImage = useCallback(
    async (file: Blob): Promise<AttachmentRef> => {
      const result = await api.upload<{ id: string; media_type: string }>('/web/attachments', file, file.type)
      return { id: result.id, mediaType: result.media_type }
    },
    [api],
  )

  const handlePermissionRespond = useCallback(
    async (requestId: string, decision: PermissionDecision) => {
      setActionError(null)
      try {
        await api.post(`/web/sessions/${encodeURIComponent(sessionId)}/control`, {
          type: 'permission_response',
          approved: decision.approved,
          request_id: requestId,
          // AskUserQuestion answers ride back as the tool's updated input.
          ...(decision.updatedInput ? { updated_input: decision.updatedInput } : {}),
          // "Always allow" rules the CLI applies and persists.
          ...(decision.updatedPermissions?.length ? { updated_permissions: decision.updatedPermissions } : {}),
          // Deny feedback the CLI forwards to the model.
          ...(decision.message ? { message: decision.message } : {}),
        })
      } catch (error) {
        setActionError(error)
      }
    },
    [api, sessionId],
  )

  // Fold the POSTed control_request back in immediately: the reducer treats it
  // as the pending mode switch, and a flaky SSE stream would otherwise lose it.
  const handleModeSelect = useCallback(
    async (mode: WebPermissionMode) => {
      setActionError(null)
      try {
        const result = await api.post<EventActionResponse>(
          `/web/sessions/${encodeURIComponent(sessionId)}/control`,
          buildSetPermissionModeRequest(randomUuid(), mode),
        )
        const event = result?.event
        if (event) setExtraEvents((prev) => [...prev, event])
      } catch (error) {
        setActionError(error)
      }
    },
    [api, sessionId],
  )

  const handleInterrupt = useCallback(async () => {
    setActionError(null)
    try {
      await api.post(`/web/sessions/${encodeURIComponent(sessionId)}/interrupt`, {})
    } catch (error) {
      setActionError(error)
    }
  }, [api, sessionId])

  // Honor both the live status event and the fetched session status, so an
  // archived session never shows an enabled composer when its status event is
  // outside the loaded history window.
  const closed = chat.closed || isSessionClosedStatus(session?.status)
  // Bridges do not always publish session_status; an open turn (until its
  // result) drives the busy affordances just as well.
  const busy = chat.status === 'running' || chat.turnOpen
  // Only the newest completed reply can be regenerated, and only while idle.
  const regenerateId =
    !closed && !busy && hasToken && latestPromptText !== null
      ? (entries.findLast(
          (entry): entry is Extract<ThreadEntry, { type: 'assistant_message' }> =>
            entry.type === 'assistant_message' && !entry.streaming,
        )?.id ?? null)
      : null
  // The streamed bubble already shows progress once its first delta lands.
  const streamingHasText = entries.some(
    (entry) => entry.type === 'assistant_message' && entry.streaming && entry.chunks.length > 0,
  )
  const displayStatus = chat.status ?? session?.status ?? 'active'
  const reconnectMessage =
    stream.status === 'error'
      ? t('disconnected', { error: stream.error ?? '' })
      : stream.status === 'reconnecting'
        ? t('reconnecting')
        : null
  // `useAccessToken` surfaces a ready-made message string; wrap it so
  // `describeError` renders it verbatim instead of the generic fallback.
  const failedToLoad = loadError ?? (tokenError ? new Error(tokenError) : null)
  const failedToLoadText = failedToLoad ? describeError(failedToLoad, 'errors.generic') : null

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
            aria-label={t('back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold text-text-primary">
              {session?.title || sessionId}
            </h1>
            <p className="truncate font-mono text-xs text-text-muted">{sessionId}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {chat.lastUsage ? (
            <span
              data-testid="token-usage"
              title={t('usage.detail', {
                prompt: String(promptTokens(chat.lastUsage)),
                cached: String(chat.lastUsage.cached),
                output: String(chat.lastUsage.output),
              })}
              className="hidden items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-muted sm:flex"
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              {t('usage.compact', { count: formatTokenCount(promptTokens(chat.lastUsage)) })}
            </span>
          ) : null}
          <PermissionModeMenu
            mode={chat.permissionMode}
            pending={chat.pendingMode !== null}
            disabled={closed}
            onSelect={handleModeSelect}
          />
          <StatusBadge status={displayStatus} />
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            aria-label={tShortcuts('open')}
            title={tShortcuts('open')}
            data-testid="shortcuts-button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
          >
            <Keyboard className="h-4 w-4" />
          </button>
        </div>
      </header>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {failedToLoad ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{failedToLoadText}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : null}

      {reconnectMessage ? (
        <div
          role="status"
          className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning"
        >
          {reconnectMessage}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
        >
          {describeError(actionError, 'errors.generic')}
        </div>
      ) : null}

      {chat.error ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
        >
          {chat.error}
        </div>
      ) : null}

      {chat.modeError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
        >
          {chat.modeError}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // The reveal anchors the first rendered item itself; the browser's
          // own scroll anchoring would pick a different node and add a second
          // correction on top.
          style={{ overflowAnchor: 'none' }}
          className="absolute inset-0 overflow-y-auto rounded-xl border border-border bg-surface-2 px-3 py-5 sm:px-6"
        >
          <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3">
            {loadingEarlier ? (
              <div className="flex justify-center py-2" role="status" aria-label={t('loadingEarlier')}>
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
              </div>
            ) : null}
            {loading && entries.length === 0 ? (
              <EmptyState title={t('loading.title')} description={t('loading.description')} />
            ) : entries.length === 0 ? (
              <EmptyState
                title={t('empty.title')}
                description={t('empty.description', { product: tCommon('claude') })}
              />
            ) : (
              <MessageThread
                items={visibleItems}
                onEdit={closed ? undefined : handleEditMessage}
                regenerateId={regenerateId}
                onRegenerate={handleRegenerate}
              />
            )}
            {failedSend ? (
              <FailedSendCard text={failedSend.text} error={failedSend.error} onRetry={handleRetrySend} />
            ) : null}
            {busy && !streamingHasText ? (
              <ThinkingIndicator label={t('thinking', { product: tCommon('claude') })} />
            ) : null}
          </div>
        </div>
        {!atBottom ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-1.5 rounded-full shadow-md"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {t('jumpToLatest')}
          </Button>
        ) : null}
      </div>

      <TaskPanel tasks={chat.tasks} />

      <PermissionPanel requests={chat.pendingPermissions} onRespond={handlePermissionRespond} />

      {closed ? (
        <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-center text-xs text-text-muted">
          {t('archived')}
        </div>
      ) : null}

      <ChatInput
        onSubmit={handleSend}
        uploadImage={handleUploadImage}
        onInterrupt={handleInterrupt}
        isLoading={busy}
        disabled={closed || !hasToken}
        placeholder={closed ? t('archivedPlaceholder') : undefined}
        commands={chat.slashCommands}
        fileSuggestions={hasToken ? suggestFiles : undefined}
      />
    </div>
  )
}

function MessageThread({
  items,
  onEdit,
  regenerateId,
  onRegenerate,
}: {
  items: KeyedItem[]
  onEdit?: (text: string) => Promise<void> | void
  regenerateId: string | null
  onRegenerate: () => Promise<void> | void
}) {
  // Editing is a singleton mode: opening another bubble's editor closes the
  // previous one so there is only ever one draft in play.
  const [editingId, setEditingId] = useState<string | null>(null)
  const cancelEdit = useCallback(() => setEditingId(null), [])

  return (
    <div className="flex flex-col gap-3">
      {items.map(({ item, key }) =>
        item.kind === 'tools' ? (
          <div key={key} data-message-key={key}>
            <ToolCallGroup entries={item.entries} />
          </div>
        ) : (
          <div key={key} data-message-key={key} className={spacingFor(item.entry)}>
            <EntryRenderer
              entry={item.entry}
              editingId={editingId}
              onStartEdit={setEditingId}
              onCancelEdit={cancelEdit}
              onEdit={onEdit}
              regenerateId={regenerateId}
              onRegenerate={onRegenerate}
            />
          </div>
        ),
      )}
    </div>
  )
}

function EntryRenderer({
  entry,
  editingId,
  onStartEdit,
  onCancelEdit,
  onEdit,
  regenerateId,
  onRegenerate,
}: {
  entry: Exclude<ThreadEntry, ToolCallEntry>
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onEdit?: (text: string) => Promise<void> | void
  regenerateId: string | null
  onRegenerate: () => Promise<void> | void
}) {
  switch (entry.type) {
    case 'user_message':
      return (
        <UserBubble
          entry={entry}
          editing={onEdit !== undefined && editingId === entry.id}
          onStartEdit={() => onStartEdit(entry.id)}
          onCancelEdit={onCancelEdit}
          onEdit={onEdit}
        />
      )
    case 'assistant_message':
      return <AssistantBubble entry={entry} canRegenerate={entry.id === regenerateId} onRegenerate={onRegenerate} />
    case 'plan':
      return <PlanView entry={entry} />
    case 'turn_end':
      return <TurnEndLine entry={entry} />
    default:
      return null
  }
}

function TurnEndLine({ entry }: { entry: TurnEndEntry }) {
  const t = useTranslations('chat')
  return (
    <div className="flex items-center justify-center gap-1.5 font-display text-[11px] text-text-muted">
      <Timer className="h-3 w-3" aria-hidden="true" />
      {t('turnDuration', { seconds: formatTurnSeconds(entry.durationMs) })}
    </div>
  )
}

function spacingFor(entry: Exclude<ThreadEntry, ToolCallEntry>): string {
  if (entry.type === 'user_message') return 'pt-6 pb-1'
  if (entry.type === 'assistant_message') return 'pt-1 pb-2'
  return 'py-1'
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="font-display text-base font-semibold text-text-primary">{title}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  )
}

function FailedSendCard({ text, error, onRetry }: { text: string; error: unknown; onRetry: () => void }) {
  const t = useTranslations('session.view')
  const describeError = useApiErrorMessage()
  return (
    <div
      role="alert"
      className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error sm:max-w-[70%]"
    >
      <p className="max-w-full truncate font-display">{text}</p>
      <p className="text-xs">
        {t('sendFailed')} {describeError(error, 'errors.generic')}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t('retrySend')}
      </Button>
    </div>
  )
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10">
        <span className="flex gap-1" aria-hidden="true">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
      <span className="pt-2 font-display text-xs text-text-muted">{label}</span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full bg-brand')} style={{ animationDelay: delay }} />
}
