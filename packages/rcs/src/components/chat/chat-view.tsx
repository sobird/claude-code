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

import { ArrowDown, ArrowLeft, Timer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { isSessionClosedStatus } from '../../contracts'
import { useAccessToken } from '../../hooks/useAccessToken'
import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { useSessionStream } from '../../hooks/useSessionStream'
import { createApiClient } from '../../lib/api-client'
import { withPendingApprovalCount } from '../../lib/approval-alert'
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
import { formatTurnSeconds } from '../../lib/turn-duration'
import { cn, uniqueKeys } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import { Button } from '../ui/button'
import { ChatInput } from './chat-input'
import { AssistantBubble, UserBubble } from './message-bubble'
import { PermissionModeMenu } from './permission-mode-menu'
import { PermissionPanel } from './permission-panel'
import { PlanView } from './plan-view'
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

export function SessionView({ sessionId }: { sessionId: string }) {
  const t = useTranslations('session.view')
  const tCommon = useTranslations('common')
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
  // Scroll height captured before prepending, so the viewport stays put.
  const preserveScrollRef = useRef<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  // Events folded in from a send response so the message shows immediately even
  // if the live stream hiccups; the SSE echo dedupes by seqNum/uuid.
  const [extraEvents, setExtraEvents] = useState<SessionEventInput[]>([])
  const [failedSend, setFailedSend] = useState<{ text: string; uuid: string; error: unknown } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

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

  const loadEarlier = useCallback(async () => {
    if (nextBefore === null || loadingEarlier) return
    const path = `/web/sessions/${encodeURIComponent(sessionId)}`
    setLoadingEarlier(true)
    try {
      const page = await api.get<HistoryResponse>(`${path}/history?limit=100&before=${nextBefore}`)
      const older = Array.isArray(page.events) ? page.events : []
      const el = scrollRef.current
      if (el) preserveScrollRef.current = el.scrollHeight
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

  // Prepended messages must not shift what the reader is looking at.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const previousHeight = preserveScrollRef.current
    if (!el || previousHeight === null) return
    el.scrollTop = el.scrollHeight - previousHeight
    preserveScrollRef.current = null
  }, [history])

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

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }, [])

  // Release the follow as soon as the reader scrolls up, so re-reading older
  // messages is never yanked back to the newest one.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    atBottomRef.current = near
    setAtBottom(near)
  }, [])

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
    async (text: string, uuid: string) => {
      setActionError(null)
      try {
        const result = await api.post<EventActionResponse>(`/web/sessions/${encodeURIComponent(sessionId)}/events`, {
          type: 'user',
          uuid,
          content: text,
          message: { content: text },
        })
        const event = result?.event
        setExtraEvents((prev) => [
          ...prev,
          event ?? { id: uuid, type: 'user', direction: 'outbound', payload: { content: text, uuid } },
        ])
        setFailedSend(null)
        scrollToBottom()
      } catch (error) {
        setFailedSend({ text, uuid, error })
        // Rethrow so the composer keeps the draft for a retry.
        throw error
      }
    },
    [api, sessionId, scrollToBottom],
  )

  const handleSend = useCallback(
    async (text: string) => {
      // Generate the uuid once so the send body, the response event, a retry,
      // and a history reload all agree on the same entry id (reducer dedupes
      // by it, so a retry that the server already accepted cannot duplicate).
      await sendWithUuid(text, randomUuid())
    },
    [sendWithUuid],
  )

  const handleRetrySend = useCallback(async () => {
    const failed = failedSend
    if (!failed) return
    try {
      await sendWithUuid(failed.text, failed.uuid)
    } catch {
      // The inline card already reports the failure.
    }
  }, [failedSend, sendWithUuid])

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
  const busy = chat.status === 'running'
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
          <PermissionModeMenu
            mode={chat.permissionMode}
            pending={chat.pendingMode !== null}
            disabled={closed}
            onSelect={handleModeSelect}
          />
          <StatusBadge status={displayStatus} />
        </div>
      </header>

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
          className="absolute inset-0 overflow-y-auto rounded-xl border border-border bg-surface-2 px-3 py-5 sm:px-6"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {nextBefore !== null ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="load-earlier"
                  onClick={() => void loadEarlier()}
                  disabled={loadingEarlier}
                >
                  {loadingEarlier ? t('loadingEarlier') : t('loadEarlier')}
                </Button>
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
              <MessageThread entries={entries} />
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
        onInterrupt={handleInterrupt}
        isLoading={busy}
        disabled={closed || !hasToken}
        placeholder={closed ? t('archivedPlaceholder') : undefined}
        commands={chat.slashCommands}
      />
    </div>
  )
}

function MessageThread({ entries }: { entries: ThreadEntry[] }) {
  const grouped = groupToolCalls(entries)
  const keyed = uniqueKeys(grouped, (item) =>
    item.kind === 'tools' ? `tools-${item.entries[0]?.toolCall.id ?? 'empty'}` : `entry-${item.entry.id}`,
  )

  return (
    <div className="flex flex-col gap-3">
      {keyed.map(({ item, key }) =>
        item.kind === 'tools' ? (
          <ToolCallGroup key={key} entries={item.entries} />
        ) : (
          <div key={key} className={spacingFor(item.entry)}>
            <EntryRenderer entry={item.entry} />
          </div>
        ),
      )}
    </div>
  )
}

function EntryRenderer({ entry }: { entry: Exclude<ThreadEntry, ToolCallEntry> }) {
  switch (entry.type) {
    case 'user_message':
      return <UserBubble entry={entry} />
    case 'assistant_message':
      return <AssistantBubble entry={entry} />
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
