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

import {
  ArrowDown,
  ArrowLeft,
  Gauge,
  Info,
  Keyboard,
  Loader2,
  Maximize2,
  Minimize2,
  ScrollText,
  Timer,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { StatusBadge } from '@/components/shell/StatusBadge'
import { Button } from '@/components/ui/Button'
import { isSessionClosedStatus } from '@/contracts'
import { useAccessToken } from '@/hooks/useAccessToken'
import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'
import { useSessionStream } from '@/hooks/useSessionStream'
import { createApiClient } from '@/lib/api-client'
import { withPendingApprovalCount } from '@/lib/approval-alert'
import { buildUserContent, type AttachmentRef } from '@/lib/attachments'
import { buildStopTaskRequest } from '@/lib/background-tasks'
import {
  copyTextForEntry,
  cursorEnterAction,
  latestPrompt,
  primaryInputOf,
  toolGroupCopyText,
} from '@/lib/message-actions'
import { latestUserKey, moveCursorKey, resolveCursorKey, type CursorItem, type CursorKind } from '@/lib/message-cursor'
import { buildThreadTree } from '@/lib/message-tree'
import { earlierStartIndex, windowStartIndex } from '@/lib/message-window'
import { buildSetModelRequest, normalizeModelOptions, type ModelOption } from '@/lib/model-settings'
import { buildSetPermissionModeRequest, nextWebPermissionMode, type WebPermissionMode } from '@/lib/permission-modes'
import type { PermissionDecision } from '@/lib/permission-suggestions'
import { randomUuid } from '@/lib/random-uuid'
import {
  activeStreamEvents,
  applyHistory,
  foldWithCache,
  hasUnseenEvents,
  isEphemeralEvent,
  type FoldCache,
  type SessionEventInput,
  type SystemEntry,
  type ThreadEntry,
  type ToolCallEntry,
  type TurnEndEntry,
} from '@/lib/session-reducer'
import { isHelpShortcut } from '@/lib/shortcut-help'
import { buildSetThinkingRequest, type ThinkingChoice } from '@/lib/thinking'
import { formatTokenCount, promptTokens } from '@/lib/token-usage'
import { formatTurnSeconds } from '@/lib/turn-duration'
import { cx, uniqueKeys } from '@/lib/utils'

import { BackgroundTaskPanel } from './BackgroundTaskPanel'
import { ChatInput } from './ChatInput'
import { AssistantBubble, UserBubble } from './MessageBubble'
import { ModelMenu } from './ModelMenu'
import { PermissionModeMenu } from './PermissionModeMenu'
import { PermissionPanel } from './PermissionPanel'
import { PlanView } from './PlanView'
import { sameChildThreads, sameEntryList } from './row-equality'
import { ShortcutsDialog } from './ShortcutsDialog'
import { SideQuestionCard, type SideQuestionState } from './SideQuestionCard'
import { TaskPanel } from './TaskPanel'
import { ThinkingMenu } from './ThinkingMenu'
import { ToolCallGroup } from './ToolCallGroup'

import styles from './ChatView.module.css'

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

const ENTRY_CURSOR_KIND: Record<Exclude<ThreadEntry, ToolCallEntry>['type'], CursorKind> = {
  user_message: 'user',
  assistant_message: 'assistant',
  plan: 'plan',
  system: 'system',
  turn_end: 'turn_end',
}

/** The keyboard cursor's coarse view of an item. */
function cursorKindOf(item: GroupedItem): CursorKind {
  return item.kind === 'tools' ? 'tools' : ENTRY_CURSOR_KIND[item.entry.type]
}

/** Newest tool call in a group whose PRIMARY_INPUT field is extractable. */
function newestPrimaryInput(entries: ToolCallEntry[]) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry) continue
    const primary = primaryInputOf(entry.toolCall.title, entry.toolCall.rawInput)
    if (primary) return primary
  }
  return null
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
  const tChat = useTranslations('chat')
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
  // `/btw` aside: transient by design — never folded into the transcript and
  // gone on refresh. The sequence ref drops answers from closed/retried asks.
  const [sideQuestion, setSideQuestion] = useState<SideQuestionState | null>(null)
  const sideQuestionSeq = useRef(0)
  const [failedSend, setFailedSend] = useState<{
    text: string
    attachments: AttachmentRef[]
    uuid: string
    error: unknown
  } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [expandAll, setExpandAll] = useState(false)
  // The detailed transcript adds informational system rows (compaction, API
  // errors, hook summaries); hidden by default, like the TUI's ctrl+o.
  const [verbose, setVerbose] = useState(false)
  // Keyboard cursor over the visible transcript; null while inactive.
  const [cursorKey, setCursorKey] = useState<string | null>(null)
  // Per-group expansion override (missing = follow the global expandAll).
  const [toolOverrides, setToolOverrides] = useState<Record<string, boolean>>({})
  // Editing is a singleton mode lifted here so the keyboard cursor can open it.
  const [editingId, setEditingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  // First rendered item, pinned by key so appends never unmount what is on
  // screen and prepended pages resolve to the same item. Null until history
  // lands, so the initial view is the newest window of the loaded transcript.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  // Pinned node's viewport top captured before a reveal; the layout effect
  // restores it after the older items mount. `target` 是这次揭示要钉住的键，
  // 过渡提交前的其他渲染不应提前消耗锚点。
  const revealAnchorRef = useRef<{ key: string; top: number; target: string } | null>(null)
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

  // Ctrl+O toggles the detailed transcript, matching the TUI.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.altKey || event.shiftKey) return
      if (!event.ctrlKey || event.key.toLowerCase() !== 'o') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true) return
      event.preventDefault()
      setVerbose((prev) => !prev)
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

  // 并发滚动事件会在 loadingEarlier 状态提交前再次进来，用 ref 挡住重复请求。
  const loadingEarlierRef = useRef(false)
  const loadEarlier = useCallback(async () => {
    if (nextBefore === null || loadingEarlierRef.current) return
    loadingEarlierRef.current = true
    const path = `/web/sessions/${encodeURIComponent(sessionId)}`
    setLoadingEarlier(true)
    try {
      const page = await api.get<HistoryResponse>(`${path}/history?limit=100&before=${nextBefore}`)
      const older = Array.isArray(page.events) ? page.events : []
      const nextCursor = typeof page.nextBefore === 'number' ? page.nextBefore : null
      // 实时流通常已重放整段历史：这类页无需合并，只推进游标，避免一次全量
      // 重折叠和整树重渲染。
      if (!hasUnseenEvents(older, knownSeqNumsRef.current)) {
        setNextBefore(nextCursor)
        return
      }
      revealAfterLoadRef.current = true
      startTransition(() => {
        setHistory((prev) => {
          const merged = new Map<number, HistoryEvent>()
          for (const event of [...older, ...(prev ?? [])]) {
            if (!merged.has(event.seqNum)) merged.set(event.seqNum, event)
          }
          return [...merged.values()].toSorted((a, b) => a.seqNum - b.seqNum)
        })
        setNextBefore(nextCursor)
      })
    } catch (error) {
      setActionError(error)
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }, [api, sessionId, nextBefore])

  // 按序列号折叠持久事件（历史、实时帧、本地发送），保证回复不会先于提问。
  // 上一批事件仍是新列表的前缀时只折叠新增尾部，避免每帧对整段历史重跑
  // reducer。流式增量没有持久序列号，单独在持久状态之上重放：只有最后一条
  // 终态事件之后的帧仍然是活的。
  const foldCacheRef = useRef<FoldCache | null>(null)
  // 当前客户端已持有的持久 seqNum，供分页判断该页是否早已由流重放覆盖。
  const knownSeqNumsRef = useRef<ReadonlySet<number>>(new Set())
  const chat = useMemo(() => {
    const merged: SessionEventInput[] = []
    for (const event of history ?? []) merged.push(event)
    for (const event of stream.events) merged.push(event)
    for (const event of extraEvents) merged.push(event)
    const durable = merged
      .filter((event) => !isEphemeralEvent(event))
      .toSorted((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0))
    const knownSeqNums = new Set<number>()
    for (const event of durable) {
      if (typeof event.seqNum === 'number') knownSeqNums.add(event.seqNum)
    }
    knownSeqNumsRef.current = knownSeqNums
    const base = foldWithCache(foldCacheRef.current, durable)
    foldCacheRef.current = base
    return applyHistory(base.state, activeStreamEvents(stream.events))
  }, [history, stream.events, extraEvents])

  const entries = chat.entries
  const entryCount = entries.length
  const streaming = entries.some((entry) => entry.type === 'assistant_message' && entry.streaming)

  // Hidden system rows are filtered from display only; prompt/turn logic reads
  // the full `entries` list.
  const displayEntries = useMemo(
    () => (verbose ? entries : entries.filter((entry) => entry.type !== 'system')),
    [entries, verbose],
  )

  // Subagent traffic points at its Agent tool call; the transcript stays flat
  // and is nested here at render time.
  const tree = useMemo(() => buildThreadTree(displayEntries), [displayEntries])

  // Only a bounded window of grouped items is mounted; older ones are revealed
  // a chunk at a time before the server page behind them is fetched.
  const keyed = useMemo<KeyedItem[]>(() => uniqueKeys(groupToolCalls(tree.top), itemKey), [tree.top])
  const windowKeys = useMemo(() => keyed.map((item) => item.key), [keyed])
  const windowStart = windowStartIndex(windowKeys, pinnedKey)
  const visibleItems = useMemo(() => keyed.slice(windowStart), [keyed, windowStart])

  // Keyboard cursor view of the visible window.
  const cursorItems = useMemo<CursorItem[]>(
    () => visibleItems.map(({ item, key }) => ({ key, kind: cursorKindOf(item) })),
    [visibleItems],
  )
  const visibleByKey = useMemo(() => new Map(visibleItems.map(({ item, key }) => [key, item])), [visibleItems])
  const cursorItem = cursorKey === null ? null : (cursorItems.find((item) => item.key === cursorKey) ?? null)
  const cursorGroup = cursorKey === null ? undefined : visibleByKey.get(cursorKey)
  // `p` only has something to copy when the selected tool group exposes one.
  const cursorPrimary = cursorGroup?.kind === 'tools' ? newestPrimaryInput(cursorGroup.entries) : null

  const isToolExpanded = useCallback((key: string) => toolOverrides[key] ?? expandAll, [toolOverrides, expandAll])
  const toggleToolExpanded = useCallback(
    (key: string) => setToolOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? expandAll) })),
    [expandAll],
  )
  // 保持引用稳定，否则每一行都会被判定为“回调已变”而重渲染。
  const cancelEdit = useCallback(() => setEditingId(null), [])

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
    const nextKey = windowKeys[earlierStartIndex(windowStart)]
    if (!nextKey) return
    const node = findMessageNode(el, first)
    if (node) revealAnchorRef.current = { key: first, top: node.getBoundingClientRect().top, target: nextKey }
    // 把挂载更早卡片的这次渲染降为过渡更新，滚动输入先保持响应。
    startTransition(() => setPinnedKey(nextKey))
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
    if (!anchor || !el) return
    // 揭示被 startTransition 延后，中间的流式提交会先跑这个 effect；
    // 等真正钉住目标键的那次提交再校正滚动位置。
    if (pinnedKey !== anchor.target) return
    revealAnchorRef.current = null

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

  // Shift+Tab walks the same cycle as the TUI; the menu and this share one sender.
  const handleCycleMode = useCallback(() => {
    void handleModeSelect(nextWebPermissionMode(chat.permissionMode))
  }, [handleModeSelect, chat.permissionMode])

  // Lazily fetch the CLI's model list; an unreachable CLI just leaves the menu
  // on the free-text fallback rather than surfacing an error.
  const loadModels = useCallback(async (): Promise<ModelOption[]> => {
    try {
      const result = await api.get<{ models?: unknown }>(`/web/sessions/${encodeURIComponent(sessionId)}/models`)
      return normalizeModelOptions(result?.models)
    } catch {
      return []
    }
  }, [api, sessionId])

  // Mirrors handleModeSelect: the reducer treats the POSTed request as pending,
  // and the display moves when the CLI's control_response arrives.
  const handleModelSelect = useCallback(
    async (model: string | null) => {
      setActionError(null)
      try {
        const result = await api.post<EventActionResponse>(
          `/web/sessions/${encodeURIComponent(sessionId)}/control`,
          buildSetModelRequest(randomUuid(), model),
        )
        const event = result?.event
        if (event) setExtraEvents((prev) => [...prev, event])
      } catch (error) {
        setActionError(error)
      }
    },
    [api, sessionId],
  )

  // Same shape as the model switch: POST the control_request, fold it locally,
  // and let the CLI's control_response move the label.
  const handleThinkingSelect = useCallback(
    async (choice: ThinkingChoice) => {
      setActionError(null)
      try {
        const result = await api.post<EventActionResponse>(
          `/web/sessions/${encodeURIComponent(sessionId)}/control`,
          buildSetThinkingRequest(randomUuid(), choice),
        )
        const event = result?.event
        if (event) setExtraEvents((prev) => [...prev, event])
      } catch (error) {
        setActionError(error)
      }
    },
    [api, sessionId],
  )

  // SDK `stop_task`: the child kills the task and answers with its own
  // `task_notification`, which removes the row (no local pending state).
  const handleStopBackgroundTask = useCallback(
    async (taskId: string) => {
      setActionError(null)
      try {
        await api.post(
          `/web/sessions/${encodeURIComponent(sessionId)}/control`,
          buildStopTaskRequest(randomUuid(), taskId),
        )
      } catch (error) {
        setActionError(error)
      }
    },
    [api, sessionId],
  )

  // `/btw`: ask the CLI's forked agent without touching the transcript. The
  // broker route answers inline; a stale response after close/retry is dropped
  // by the sequence check. The answer never enters the event stream, so a
  // refresh naturally forgets it. Returns immediately so the composer clears
  // the draft while the card shows progress.
  const handleSideQuestion = useCallback(
    (question: string) => {
      const seq = ++sideQuestionSeq.current
      setSideQuestion({ question, status: 'pending', answer: null, error: null })
      void (async () => {
        try {
          const result = await api.post<{ answer?: unknown }>(
            `/web/sessions/${encodeURIComponent(sessionId)}/side-question`,
            { question },
          )
          if (sideQuestionSeq.current !== seq) return
          const answer = typeof result?.answer === 'string' ? result.answer : null
          setSideQuestion({ question, status: 'done', answer, error: null })
        } catch (error) {
          if (sideQuestionSeq.current !== seq) return
          setSideQuestion({
            question,
            status: 'error',
            answer: null,
            error: describeError(error, 'chat.sideQuestion.error'),
          })
        }
      })()
    },
    [api, sessionId, describeError],
  )

  const closeSideQuestion = useCallback(() => {
    sideQuestionSeq.current += 1
    setSideQuestion(null)
  }, [])

  const retrySideQuestion = useCallback(() => {
    if (sideQuestion) handleSideQuestion(sideQuestion.question)
  }, [handleSideQuestion, sideQuestion])

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

  const copyToClipboard = useCallback((text: string) => {
    if (!text || !navigator.clipboard) return
    void navigator.clipboard.writeText(text).catch(() => {})
  }, [])

  // Keyboard message actions, mirroring the TUI: Shift+↑ enters the cursor and
  // the arrows/j/k move it. The permission panel listens on `document` and
  // calls preventDefault for its own keys; a `window` listener runs after it,
  // so `event.defaultPrevented` keeps those shortcuts from being stolen.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shortcutsOpen) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true) return

      const action = resolveCursorKey({
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
        cursorActive: cursorKey !== null,
      })
      if (action.action === 'ignore') return

      const item = cursorKey !== null ? visibleByKey.get(cursorKey) : undefined
      switch (action.action) {
        case 'enter-cursor':
          setCursorKey(latestUserKey(cursorItems))
          ;(document.activeElement as HTMLElement | null)?.blur()
          break
        case 'move':
          setCursorKey(moveCursorKey(cursorItems, cursorKey, action.move))
          break
        case 'enter': {
          if (!item || cursorKey === null) break
          const enter = cursorEnterAction({ key: cursorKey, kind: cursorKindOf(item) })
          if (enter === 'edit' && item.kind === 'entry' && item.entry.type === 'user_message' && !closed) {
            setEditingId(item.entry.id)
            setCursorKey(null)
          } else if (enter === 'toggle' && item.kind === 'tools') {
            toggleToolExpanded(cursorKey)
          }
          break
        }
        case 'copy':
          if (!item) break
          copyToClipboard(item.kind === 'tools' ? toolGroupCopyText(item.entries) : copyTextForEntry(item.entry))
          break
        case 'copy-primary': {
          const primary = item?.kind === 'tools' ? newestPrimaryInput(item.entries) : null
          if (primary) copyToClipboard(primary.value)
          break
        }
        case 'exit':
          setCursorKey(null)
          break
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cursorKey, cursorItems, visibleByKey, closed, shortcutsOpen, toggleToolExpanded, copyToClipboard])

  // A cursor pointing at an item that left the visible window (a reveal, a
  // transcript filter toggle) re-lands on the nearest item instead of vanishing.
  useEffect(() => {
    if (cursorKey === null) return
    if (cursorItems.some((item) => item.key === cursorKey)) return
    setCursorKey(moveCursorKey(cursorItems, cursorKey, 'prev'))
  }, [cursorItems, cursorKey])

  // Keep the selected item on screen as the cursor moves.
  useEffect(() => {
    if (cursorKey === null) return
    const el = scrollRef.current
    if (!el) return
    findMessageNode(el, cursorKey)?.scrollIntoView({ block: 'nearest' })
  }, [cursorKey])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.backLink} aria-label={t('back')}>
            <ArrowLeft className={styles.backIcon} />
          </Link>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{session?.title || sessionId}</h1>
            <p className={styles.sessionId}>{sessionId}</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          {chat.lastUsage ? (
            <span
              data-testid="token-usage"
              title={t('usage.detail', {
                prompt: String(promptTokens(chat.lastUsage)),
                cached: String(chat.lastUsage.cached),
                output: String(chat.lastUsage.output),
              })}
              className={styles.usage}
            >
              <Gauge className={styles.usageIcon} aria-hidden="true" />
              {t('usage.compact', { count: formatTokenCount(promptTokens(chat.lastUsage)) })}
            </span>
          ) : null}
          <ModelMenu
            model={chat.model}
            pending={chat.pendingModel !== null}
            disabled={closed}
            onSelect={handleModelSelect}
            loadModels={loadModels}
          />
          <ThinkingMenu
            value={chat.thinking}
            pending={chat.pendingThinking !== null}
            disabled={closed}
            onSelect={handleThinkingSelect}
          />
          <PermissionModeMenu
            mode={chat.permissionMode}
            pending={chat.pendingMode !== null}
            disabled={closed}
            onSelect={handleModeSelect}
          />
          <StatusBadge status={displayStatus} />
          <button
            type="button"
            onClick={() => {
              // A fresh global toggle clears per-group overrides so every card
              // follows the header switch.
              setToolOverrides({})
              setExpandAll((prev) => !prev)
            }}
            aria-label={expandAll ? tChat('collapseAll') : tChat('expandAll')}
            title={expandAll ? tChat('collapseAll') : tChat('expandAll')}
            aria-pressed={expandAll}
            data-testid="toggle-expand-all"
            className={styles.iconButton}
          >
            {expandAll ? (
              <Minimize2 className={styles.iconButtonIcon} />
            ) : (
              <Maximize2 className={styles.iconButtonIcon} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setVerbose((prev) => !prev)}
            aria-label={verbose ? tChat('verbose.hide') : tChat('verbose.show')}
            title={verbose ? tChat('verbose.hide') : tChat('verbose.show')}
            aria-pressed={verbose}
            data-testid="toggle-verbose"
            className={styles.iconButton}
          >
            <ScrollText className={styles.iconButtonIcon} />
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            aria-label={tShortcuts('open')}
            title={tShortcuts('open')}
            data-testid="shortcuts-button"
            className={styles.iconButton}
          >
            <Keyboard className={styles.iconButtonIcon} />
          </button>
        </div>
      </header>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {failedToLoad ? (
        <div role="alert" className={styles.errorBanner}>
          <span>{failedToLoadText}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : null}

      {reconnectMessage ? (
        <div role="status" className={styles.noticeBanner}>
          {reconnectMessage}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className={styles.errorNotice}>
          {describeError(actionError, 'errors.generic')}
        </div>
      ) : null}

      {chat.error ? (
        <div role="alert" className={styles.errorNotice}>
          {chat.error}
        </div>
      ) : null}

      {chat.modeError ? (
        <div role="alert" className={styles.errorNotice}>
          {chat.modeError}
        </div>
      ) : null}

      {chat.modelError ? (
        <div role="alert" className={styles.errorNotice}>
          {chat.modelError}
        </div>
      ) : null}

      {chat.thinkingError ? (
        <div role="alert" className={styles.errorNotice}>
          {chat.thinkingError}
        </div>
      ) : null}

      <div className={styles.threadPane}>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // The reveal anchors the first rendered item itself; the browser's
          // own scroll anchoring would pick a different node and add a second
          // correction on top.
          style={{ overflowAnchor: 'none' }}
          className={styles.scroll}
        >
          <div ref={contentRef} className={styles.content}>
            {loadingEarlier ? (
              <div className={styles.earlierRow} role="status" aria-label={t('loadingEarlier')}>
                <Loader2 className={styles.earlierSpinner} />
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
                expandAll={expandAll}
                editingId={editingId}
                onStartEdit={setEditingId}
                onCancelEdit={cancelEdit}
                selectedKey={cursorKey}
                isToolExpanded={isToolExpanded}
                onToggleTools={toggleToolExpanded}
                childrenByParent={tree.childrenByParent}
              />
            )}
            {failedSend ? (
              <FailedSendCard text={failedSend.text} error={failedSend.error} onRetry={handleRetrySend} />
            ) : null}
            {busy && !streamingHasText ? (
              <ThinkingIndicator label={t('working', { product: tCommon('claude') })} />
            ) : null}
          </div>
        </div>
        {!atBottom ? (
          <Button type="button" variant="outline" size="sm" onClick={scrollToBottom} className={styles.jumpButton}>
            <ArrowDown className={styles.jumpIcon} />
            {t('jumpToLatest')}
          </Button>
        ) : null}
      </div>

      <TaskPanel tasks={chat.tasks} />

      <BackgroundTaskPanel tasks={chat.backgroundTasks} onStop={handleStopBackgroundTask} />

      <PermissionPanel requests={chat.pendingPermissions} onRespond={handlePermissionRespond} />

      {cursorItem ? (
        <MessageActionsBar
          enterLabel={
            cursorItem.kind === 'user'
              ? tChat('messageActions.edit')
              : cursorItem.kind === 'tools'
                ? isToolExpanded(cursorItem.key)
                  ? tChat('messageActions.collapse')
                  : tChat('messageActions.expand')
                : null
          }
          showPrimary={cursorPrimary !== null}
        />
      ) : null}

      {closed ? <div className={styles.archivedNotice}>{t('archived')}</div> : null}

      <SideQuestionCard state={sideQuestion} onClose={closeSideQuestion} onRetry={retrySideQuestion} />

      <ChatInput
        onSubmit={handleSend}
        onSideQuestion={closed || !hasToken ? undefined : handleSideQuestion}
        uploadImage={handleUploadImage}
        onInterrupt={handleInterrupt}
        isLoading={busy}
        disabled={closed || !hasToken}
        placeholder={closed ? t('archivedPlaceholder') : undefined}
        commands={chat.slashCommands}
        fileSuggestions={hasToken ? suggestFiles : undefined}
        onCyclePermissionMode={
          chat.permissionMode !== null && chat.pendingMode === null && !closed ? handleCycleMode : undefined
        }
      />
    </div>
  )
}

function MessageThread({
  items,
  onEdit,
  regenerateId,
  onRegenerate,
  expandAll = false,
  editingId,
  onStartEdit,
  onCancelEdit,
  selectedKey,
  isToolExpanded,
  onToggleTools,
  childrenByParent,
}: {
  items: KeyedItem[]
  onEdit?: (text: string) => Promise<void> | void
  regenerateId: string | null
  onRegenerate: () => Promise<void> | void
  expandAll?: boolean
  /** Editing is a singleton lifted to the view so the keyboard cursor can open it. */
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  /** Keyboard-cursor selection, keyed like the grouped items. */
  selectedKey: string | null
  isToolExpanded: (key: string) => boolean
  onToggleTools: (key: string) => void
  /** Subagent transcript keyed by its parent Agent tool id. */
  childrenByParent: Map<string, ThreadEntry[]>
}) {
  return (
    <div className={styles.thread}>
      {items.map(({ item, key }) => (
        <MessageRow
          key={key}
          item={item}
          itemKey={key}
          selected={selectedKey === key}
          expandAll={expandAll}
          expanded={item.kind === 'tools' ? isToolExpanded(key) : false}
          editingId={editingId}
          regenerateId={regenerateId}
          onEdit={onEdit}
          onRegenerate={onRegenerate}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onToggleTools={onToggleTools}
          childrenByParent={childrenByParent}
        />
      ))}
    </div>
  )
}

interface MessageRowProps {
  item: GroupedItem
  itemKey: string
  selected: boolean
  expandAll: boolean
  /** 工具组是否展开；条目行忽略。 */
  expanded: boolean
  editingId: string | null
  regenerateId: string | null
  onEdit?: (text: string) => Promise<void> | void
  onRegenerate: () => Promise<void> | void
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onToggleTools: (key: string) => void
  childrenByParent: Map<string, ThreadEntry[]>
}

/**
 * 单行记忆化：分组会重建数组与 Map，所以比较元素引用而非容器；编辑/重生成
 * 状态只让命中该行的那条消息重渲染，光标选择同理。
 */
function sameMessageRow(prev: MessageRowProps, next: MessageRowProps): boolean {
  if (prev.itemKey !== next.itemKey || prev.selected !== next.selected) return false
  const before = prev.item
  const after = next.item
  if (before.kind === 'tools') {
    if (after.kind !== 'tools') return false
    if (prev.expandAll !== next.expandAll || prev.expanded !== next.expanded) return false
    if (!sameEntryList(before.entries, after.entries)) return false
    if (prev.childrenByParent !== next.childrenByParent) {
      const ids = before.entries.map((entry) => entry.toolCall.id)
      if (!sameChildThreads(prev.childrenByParent, next.childrenByParent, ids)) return false
    }
    return true
  }
  if (after.kind !== 'entry' || before.entry !== after.entry) return false
  if (prev.onEdit !== next.onEdit || prev.onRegenerate !== next.onRegenerate) return false
  if (prev.editingId !== next.editingId && (before.entry.id === prev.editingId || before.entry.id === next.editingId)) {
    return false
  }
  if (
    prev.regenerateId !== next.regenerateId &&
    (before.entry.id === prev.regenerateId || before.entry.id === next.regenerateId)
  ) {
    return false
  }
  return true
}

const MessageRow = memo(function MessageRow({
  item,
  itemKey,
  selected,
  expandAll,
  expanded,
  editingId,
  regenerateId,
  onEdit,
  onRegenerate,
  onStartEdit,
  onCancelEdit,
  onToggleTools,
  childrenByParent,
}: MessageRowProps) {
  const selection = cx(styles.item, selected && styles.itemSelected)
  if (item.kind === 'tools') {
    return (
      <div data-message-key={itemKey} data-selected={selected ? '' : undefined} className={selection}>
        <ToolCallGroup
          entries={item.entries}
          expandAll={expandAll}
          expanded={expanded}
          onToggleExpanded={() => onToggleTools(itemKey)}
          childrenByParent={childrenByParent}
        />
      </div>
    )
  }
  return (
    <div
      data-message-key={itemKey}
      data-selected={selected ? '' : undefined}
      className={cx(spacingFor(item.entry), selection)}
    >
      <EntryRenderer
        entry={item.entry}
        editingId={editingId}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onEdit={onEdit}
        regenerateId={regenerateId}
        onRegenerate={onRegenerate}
      />
    </div>
  )
}, sameMessageRow)

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
    case 'system':
      return <SystemRow entry={entry} />
    case 'turn_end':
      return <TurnEndLine entry={entry} />
    default:
      return null
  }
}

function SystemRow({ entry }: { entry: SystemEntry }) {
  const t = useTranslations('chat')
  return (
    <div className={cx(styles.systemRow, entry.level === 'error' ? styles.systemError : styles.systemMuted)}>
      <Info className={styles.systemIcon} aria-hidden="true" />
      <span className={styles.systemText}>{systemText(entry, t)}</span>
    </div>
  )
}

function systemText(entry: SystemEntry, t: ReturnType<typeof useTranslations<'chat'>>): string {
  switch (entry.subtype) {
    case 'compact_boundary':
      return t('system.compacted')
    case 'microcompact_boundary':
      return t('system.microcompacted')
    case 'permission_retry':
      return t('system.allowed', { commands: entry.commands?.join(', ') ?? '' })
    case 'memory_saved':
      return t('system.memorySaved', { paths: entry.writtenPaths?.join(', ') ?? '' })
    case 'api_error':
      return entry.content ?? t('system.apiError')
    case 'stop_hook_summary':
      return entry.content ?? t('system.hookSummary')
    case 'local_command':
      return entry.content ?? t('system.localCommand')
    case 'task_notification': {
      const status =
        entry.taskStatus === 'failed'
          ? t('backgroundTasks.status.failed')
          : entry.taskStatus === 'stopped' || entry.taskStatus === 'killed'
            ? t('backgroundTasks.status.stopped')
            : t('backgroundTasks.status.completed')
      return t('system.taskNotification', { status, summary: entry.content ?? '' })
    }
    default:
      return entry.content ?? entry.subtype
  }
}

function MessageActionsBar({ enterLabel, showPrimary }: { enterLabel: string | null; showPrimary: boolean }) {
  const t = useTranslations('chat')
  const hint = (keys: string, label: string) => (
    <span key={keys} className={styles.hint}>
      <kbd className={styles.kbd}>{keys}</kbd>
      <span>{label}</span>
    </span>
  )
  return (
    <div data-testid="message-actions-bar" className={styles.actionsBar}>
      {hint('↑/↓', t('messageActions.navigate'))}
      {enterLabel ? hint('Enter', enterLabel) : null}
      {hint('c', t('messageActions.copy'))}
      {showPrimary ? hint('p', t('messageActions.copyPrimaryGeneric')) : null}
      {hint('Esc', t('messageActions.back'))}
    </div>
  )
}

function TurnEndLine({ entry }: { entry: TurnEndEntry }) {
  const t = useTranslations('chat')
  return (
    <div className={styles.turnEnd}>
      <Timer className={styles.turnEndIcon} aria-hidden="true" />
      {t('turnDuration', { seconds: formatTurnSeconds(entry.durationMs) })}
    </div>
  )
}

function spacingFor(entry: Exclude<ThreadEntry, ToolCallEntry>): string {
  if (entry.type === 'user_message') return styles.spacingUser
  if (entry.type === 'assistant_message') return styles.spacingAssistant
  return styles.spacingDefault
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState}>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyDescription}>{description}</p>
    </div>
  )
}

function FailedSendCard({ text, error, onRetry }: { text: string; error: unknown; onRetry: () => void }) {
  const t = useTranslations('session.view')
  const describeError = useApiErrorMessage()
  return (
    <div role="alert" className={styles.failedCard}>
      <p className={styles.failedText}>{text}</p>
      <p className={styles.failedDetail}>
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
    <div className={styles.thinking}>
      <div className={styles.thinkingAvatar}>
        <span className={styles.dots} aria-hidden="true">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
      <span className={styles.thinkingLabel}>{label}</span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return <span className={styles.dot} style={{ animationDelay: delay }} />
}
