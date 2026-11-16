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

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isSessionClosedStatus } from '../../contracts'
import { useAccessToken } from '../../hooks/useAccessToken'
import { useSessionStream } from '../../hooks/useSessionStream'
import { ApiError, createApiClient } from '../../lib/api-client'
import {
  applyHistory,
  initialChatState,
  type SessionEventInput,
  type ThreadEntry,
  type ToolCallEntry,
} from '../../lib/session-reducer'
import { cn, uniqueKeys } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import { Button } from '../ui/button'
import { ChatInput } from './chat-input'
import { AssistantBubble, UserBubble } from './message-bubble'
import { PermissionPanel } from './permission-panel'
import { PlanView } from './plan-view'
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

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}

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
  const { token, refresh: refreshToken, error: tokenError } = useAccessToken()
  const tokenRef = useRef(token)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const api = useMemo(() => createApiClient({ getToken: () => tokenRef.current, refreshToken }), [refreshToken])

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [history, setHistory] = useState<HistoryEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Events folded in from a send response so the message shows immediately even
  // if the live stream hiccups; the SSE echo dedupes by seqNum/uuid.
  const [extraEvents, setExtraEvents] = useState<SessionEventInput[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

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
    } catch (error) {
      setLoadError(toMessage(error))
    } finally {
      setLoading(false)
    }
  }, [api, sessionId])

  useEffect(() => {
    if (!hasToken) return
    void load()
  }, [hasToken, load])

  // Fold history first, then live frames and locally-sent events, all ordered
  // by durable sequence so an assistant reply never lands before its prompt.
  const chat = useMemo(() => {
    const merged: SessionEventInput[] = []
    for (const event of history ?? []) merged.push(event)
    for (const event of stream.events) merged.push(event)
    for (const event of extraEvents) merged.push(event)
    merged.sort((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0))
    return applyHistory(initialChatState, merged)
  }, [history, stream.events, extraEvents])

  const entries = chat.entries
  const entryCount = entries.length

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entryCount])

  const handleSend = useCallback(
    async (text: string) => {
      setActionError(null)
      // Generate the uuid once so the send body, the response event, and a
      // history reload all agree on the same entry id (reducer dedupes by it).
      const uuid = crypto.randomUUID()
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
      } catch (error) {
        setActionError(toMessage(error))
        // Rethrow so the composer keeps the draft for a retry.
        throw error
      }
    },
    [api, sessionId],
  )

  const handlePermissionRespond = useCallback(
    async (requestId: string, approved: boolean) => {
      setActionError(null)
      try {
        await api.post(`/web/sessions/${encodeURIComponent(sessionId)}/control`, {
          type: 'permission_response',
          approved,
          request_id: requestId,
        })
      } catch (error) {
        setActionError(toMessage(error))
      }
    },
    [api, sessionId],
  )

  const handleInterrupt = useCallback(async () => {
    setActionError(null)
    try {
      await api.post(`/web/sessions/${encodeURIComponent(sessionId)}/interrupt`, {})
    } catch (error) {
      setActionError(toMessage(error))
    }
  }, [api, sessionId])

  // Honor both the live status event and the fetched session status, so an
  // archived session never shows an enabled composer when its status event is
  // outside the loaded history window.
  const closed = chat.closed || isSessionClosedStatus(session?.status)
  const busy = chat.status === 'running'
  const displayStatus = chat.status ?? session?.status ?? 'active'
  const reconnectError = stream.status === 'error' ? (stream.error ?? 'Live updates disconnected') : null
  const reconnecting = stream.status === 'reconnecting'
  const failedToLoad = loadError ?? tokenError

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
            aria-label="Back to dashboard"
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
        <StatusBadge status={displayStatus} />
      </header>

      {failedToLoad ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{failedToLoad}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {reconnectError || reconnecting ? (
        <div
          role="status"
          className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning"
        >
          {reconnectError ? `Live updates disconnected: ${reconnectError}` : 'Reconnecting to live updates…'}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
        >
          {actionError}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-2 px-3 py-5 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {loading && entries.length === 0 ? (
            <EmptyState title="Loading conversation…" description="Fetching session history." />
          ) : entries.length === 0 ? (
            <EmptyState title="开始对话" description="输入消息开始与 Claude 对话。" />
          ) : (
            <MessageThread entries={entries} onPermissionRespond={handlePermissionRespond} />
          )}
          {busy ? <ThinkingIndicator /> : null}
        </div>
      </div>

      <PermissionPanel requests={chat.pendingPermissions} onRespond={handlePermissionRespond} />

      {closed ? (
        <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-center text-xs text-text-muted">
          会话已归档，无法发送新消息。
        </div>
      ) : null}

      <ChatInput
        onSubmit={handleSend}
        onInterrupt={handleInterrupt}
        isLoading={busy}
        disabled={closed || !hasToken}
        placeholder={closed ? 'Session archived' : undefined}
      />
    </div>
  )
}

function MessageThread({
  entries,
  onPermissionRespond,
}: {
  entries: ThreadEntry[]
  onPermissionRespond: (requestId: string, approved: boolean) => void
}) {
  const grouped = groupToolCalls(entries)
  const keyed = uniqueKeys(grouped, (item) =>
    item.kind === 'tools' ? `tools-${item.entries[0]?.toolCall.id ?? 'empty'}` : `entry-${item.entry.id}`,
  )

  return (
    <div className="flex flex-col gap-3">
      {keyed.map(({ item, key }) =>
        item.kind === 'tools' ? (
          <ToolCallGroup key={key} entries={item.entries} onPermissionRespond={onPermissionRespond} />
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
    default:
      return null
  }
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

function ThinkingIndicator() {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10">
        <span className="flex gap-1" aria-hidden="true">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
      <span className="pt-2 font-display text-xs text-text-muted">Claude is working…</span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full bg-brand')} style={{ animationDelay: delay }} />
}
