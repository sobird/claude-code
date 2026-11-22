'use client'

/**
 * 演示控制台的实时适配器。
 *
 * 轮询网关获取会话与环境（10 秒，与仪表盘一致），一次性加载活动会话的历史，
 * 把实时 SSE 帧折叠进纯粹的 `session-reducer`，再将结果映射到控制台的视图模型。
 * 发送消息和审批权限使用与 `ChatView` 相同的 endpoints。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EnvironmentSummary, SessionSummary } from '@/components/shell/types'
import { useAccessToken } from '@/hooks/useAccessToken'
import { useSessionStream } from '@/hooks/useSessionStream'
import { ApiError, createApiClient } from '@/lib/api-client'
import { randomUuid } from '@/lib/random-uuid'
import {
  activeStreamEvents,
  applyHistory,
  initialChatState,
  isEphemeralEvent,
  type ChatState,
  type SessionEventInput,
  type ThreadEntry,
} from '@/lib/session-reducer'

import type { ActiveSession, DemoEnvironment, Entry, FleetSession, SessionStatus, ToolLine } from './types'

const POLL_INTERVAL_MS = 10_000
const CONTEXT_LIMIT = 200_000

interface HistoryResponse {
  events: SessionEventInput[]
  nextBefore: number | null
}

interface SessionDetailResponse {
  id: string
  title: string | null
  status: string
  environment_id: string | null
}

interface EventActionResponse {
  status: string
  event?: SessionEventInput
}

export interface LiveConsole {
  /** 首次 sessions/environments 轮询结束后（无论成功失败）为 true。 */
  loading: boolean
  /** 存在网关 token；用户接管后界面即可写入。 */
  authenticated: boolean
  /** 没有 token 且签发失败 —— 展示登录 CTA。 */
  signedOut: boolean
  connection: 'connecting' | 'connected' | 'error'
  latencyMs: number | null
  error: string | null
  sessions: FleetSession[]
  environments: DemoEnvironment[]
  activeId: string | null
  setActiveId: (id: string) => void
  active: ActiveSession | null
  send: (text: string) => Promise<void>
  respondPermission: (requestId: string, approved: boolean) => Promise<void>
  createSession: (input: { title?: string; environmentId: string }) => Promise<string>
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

function mapStatus(raw: string | null | undefined): SessionStatus {
  if (raw === 'running') return 'running'
  if (raw === 'active' || raw === 'requires_action') return 'active'
  // idle / inactive / archived（已关闭的行永远不会进入列表）都显示为空闲。
  return 'idle'
}

function relativeTime(epochSeconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds))
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86_400) return `${Math.floor(delta / 3600)} 小时前`
  return `${Math.floor(delta / 86_400)} 天前`
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':')
}

function truncate(value: string, max = 72): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const DETAIL_KEYS = [
  'command',
  'file_path',
  'path',
  'notebook_path',
  'pattern',
  'glob',
  'query',
  'url',
  'description',
  'prompt',
] as const

function toolDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  for (const key of DETAIL_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return truncate(value)
  }
  return ''
}

function toolLineOf(entry: Extract<ThreadEntry, { type: 'tool_call' }>): ToolLine {
  const { toolCall } = entry
  const state: ToolLine['state'] =
    toolCall.status === 'running' || toolCall.status === 'waiting_for_confirmation'
      ? 'running'
      : toolCall.status === 'error' || toolCall.status === 'rejected' || toolCall.status === 'canceled'
        ? 'error'
        : 'done'
  return { name: toolCall.title || 'tool', detail: toolDetail(toolCall.rawInput), time: '', state }
}

/**
 * 把 reducer 的扁平 transcript 折叠为控制台的分组条目：连续的若干工具调用
 * 合并成一条日志，待处理的权限请求变成卡片。
 */
function mapEntries(chat: ChatState): Entry[] {
  const entries: Entry[] = []
  let tools: ToolLine[] = []
  const flushTools = () => {
    if (tools.length > 0) {
      entries.push({ kind: 'tools', items: tools })
      tools = []
    }
  }

  for (const entry of chat.entries) {
    switch (entry.type) {
      case 'user_message': {
        flushTools()
        if (entry.content) entries.push({ kind: 'user', text: entry.content, at: '' })
        break
      }
      case 'assistant_message': {
        const text = entry.chunks
          .filter((chunk) => chunk.type === 'message')
          .map((chunk) => chunk.text)
          .join('\n\n')
          .trim()
        if (text) {
          flushTools()
          entries.push({
            kind: 'assistant',
            paragraphs: text.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0),
          })
        }
        break
      }
      case 'tool_call': {
        tools.push(toolLineOf(entry))
        break
      }
      case 'plan': {
        flushTools()
        entries.push({ kind: 'assistant', paragraphs: entry.entries.map((item) => `• ${item.content}`) })
        break
      }
      case 'system': {
        if (entry.content) {
          flushTools()
          entries.push({ kind: 'system', text: entry.content })
        }
        break
      }
      case 'turn_end': {
        flushTools()
        entries.push({ kind: 'system', text: `回合结束 · ${(entry.durationMs / 1000).toFixed(1)}s` })
        break
      }
    }
  }
  flushTools()

  for (const permission of chat.pendingPermissions) {
    const command =
      typeof permission.toolInput.command === 'string' && permission.toolInput.command
        ? permission.toolInput.command
        : truncate(JSON.stringify(permission.toolInput), 120)
    entries.push({
      kind: 'permission',
      title: `允许 ${permission.toolName || '工具'}？`,
      detail:
        permission.description ??
        (permission.blockedPath ? `需要访问 ${permission.blockedPath}` : '智能体请求调用一个工具。'),
      command: command || '(无参数)',
      requestId: permission.requestId,
    })
  }

  return entries
}

export function useLiveConsole(enabled: boolean): LiveConsole {
  const { token, refresh: refreshToken, error: tokenError } = useAccessToken()
  const tokenRef = useRef(token)
  const inFlightRef = useRef(false)

  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  const [environmentRows, setEnvironmentRows] = useState<EnvironmentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null)
  const [history, setHistory] = useState<SessionEventInput[]>([])
  const [extraEvents, setExtraEvents] = useState<SessionEventInput[]>([])

  // 只有 token 是否存在才驱动重新加载；它的周期性轮换不能重置
  // transcript 或重启轮询循环。
  const hasToken = token !== null

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const api = useMemo(
    () =>
      createApiClient({
        getToken: () => tokenRef.current,
        refreshToken,
      }),
    [refreshToken],
  )

  const load = useCallback(async () => {
    if (!enabled || tokenRef.current === null || inFlightRef.current) return
    inFlightRef.current = true
    const startedAt = Date.now()
    try {
      const [nextSessions, nextEnvironments] = await Promise.all([
        api.get<SessionSummary[]>('/web/sessions/all'),
        api.get<EnvironmentSummary[]>('/web/environments'),
      ])
      setSummaries(Array.isArray(nextSessions) ? nextSessions : [])
      setEnvironmentRows(Array.isArray(nextEnvironments) ? nextEnvironments : [])
      setLatencyMs(Date.now() - startedAt)
      setConnection('connected')
      setError(null)
    } catch (loadError) {
      setError(errorMessage(loadError))
      setConnection('error')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [api, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    if (!hasToken) {
      if (tokenError !== null) {
        setConnection('error')
        setError(tokenError)
        setLoading(false)
      }
      return undefined
    }
    setConnection('connecting')
    void load()
    const timer = setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [enabled, hasToken, tokenError, load])

  // 保持选中项有效：默认选最近更新的会话。
  useEffect(() => {
    if (!enabled) return
    if (summaries.length === 0) {
      setActiveIdState((current) => (current === null ? current : null))
      return
    }
    setActiveIdState((current) => {
      if (current && summaries.some((summary) => summary.id === current)) return current
      const newest = summaries.toSorted((a, b) => b.updated_at - a.updated_at)[0]
      return newest ? newest.id : null
    })
  }, [enabled, summaries])

  // 加载活动会话的详情和第一页历史。
  useEffect(() => {
    if (!enabled || activeId === null || !hasToken) return undefined
    let cancelled = false
    setDetail(null)
    setHistory([])
    setExtraEvents([])
    const path = `/web/sessions/${encodeURIComponent(activeId)}`
    void (async () => {
      try {
        const [nextDetail, page] = await Promise.all([
          api.get<SessionDetailResponse>(path),
          api.get<HistoryResponse>(`${path}/history?limit=100`),
        ])
        if (cancelled) return
        setDetail(nextDetail)
        setHistory(Array.isArray(page.events) ? page.events : [])
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, activeId, hasToken, api])

  const stream = useSessionStream(enabled ? activeId : null)

  const chat = useMemo(() => {
    const merged: SessionEventInput[] = [...history, ...stream.events, ...extraEvents]
    const durable = merged
      .filter((event) => !isEphemeralEvent(event))
      .toSorted((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0))
    return applyHistory(applyHistory(initialChatState, durable), activeStreamEvents(stream.events))
  }, [history, stream.events, extraEvents])

  const environments = useMemo<DemoEnvironment[]>(
    () =>
      environmentRows.map((row) => ({
        id: row.id,
        name: row.machine_name ?? row.directory ?? row.id.slice(0, 8),
        host: row.worker_type,
        status: row.status === 'active' ? 'online' : 'offline',
      })),
    [environmentRows],
  )

  const environmentById = useMemo(() => new Map(environmentRows.map((row) => [row.id, row])), [environmentRows])

  const sessions = useMemo<FleetSession[]>(() => {
    return summaries
      .toSorted((a, b) => b.updated_at - a.updated_at)
      .map((summary) => {
        const environment = summary.environment_id ? environmentById.get(summary.environment_id) : undefined
        return {
          id: summary.id,
          environmentId: summary.environment_id ?? null,
          title: summary.title ?? '未命名会话',
          status: mapStatus(summary.status),
          updated: relativeTime(summary.updated_at),
          branch: environment?.branch ?? '—',
          elapsed: '—',
          tokens: 0,
          limit: CONTEXT_LIMIT,
          entries: [],
          tasks: [],
        }
      })
  }, [summaries, environmentById])

  const active = useMemo<ActiveSession | null>(() => {
    const summary = activeId ? summaries.find((item) => item.id === activeId) : undefined
    if (!summary) return null
    const environment = summary.environment_id ? environmentById.get(summary.environment_id) : undefined
    const tokens = chat.lastUsage ? chat.lastUsage.input + chat.lastUsage.cached + chat.lastUsage.output : 0
    return {
      id: summary.id,
      environmentId: summary.environment_id ?? null,
      title: detail?.title ?? summary.title ?? '未命名会话',
      status: mapStatus(detail?.status ?? chat.status ?? summary.status),
      updated: relativeTime(summary.updated_at),
      branch: environment?.branch ?? '—',
      elapsed: chat.turnStartedAt ? formatClock((Date.now() - chat.turnStartedAt) / 1000) : '—',
      tokens,
      limit: CONTEXT_LIMIT,
      entries: mapEntries(chat),
      tasks: chat.tasks.map((task) => ({
        label: task.content,
        done: task.status === 'completed',
        active: task.status === 'in_progress',
      })),
      closed: chat.closed,
      streaming: chat.entries.some((entry) => entry.type === 'assistant_message' && entry.streaming === true),
      turnOpen: chat.turnOpen,
    }
  }, [activeId, summaries, environmentById, detail, chat])

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
  }, [])

  const send = useCallback(
    async (text: string) => {
      if (activeId === null) throw new Error('没有选中的会话')
      const uuid = randomUuid()
      const result = await api.post<EventActionResponse>(`/web/sessions/${encodeURIComponent(activeId)}/events`, {
        type: 'user',
        uuid,
        content: text,
        message: { content: text },
      })
      setExtraEvents((prev) => [
        ...prev,
        result?.event ?? { id: uuid, type: 'user', direction: 'outbound', payload: { content: text, uuid } },
      ])
    },
    [api, activeId],
  )

  const respondPermission = useCallback(
    async (requestId: string, approved: boolean) => {
      if (activeId === null) return
      await api.post(`/web/sessions/${encodeURIComponent(activeId)}/control`, {
        type: 'permission_response',
        approved,
        request_id: requestId,
      })
    },
    [api, activeId],
  )

  const createSession = useCallback(
    async (input: { title?: string; environmentId: string }) => {
      const created = await api.post<{ id: string }>('/web/sessions', {
        title: input.title,
        environment_id: input.environmentId,
      })
      await load()
      setActiveIdState(created.id)
      return created.id
    },
    [api, load],
  )

  return {
    loading,
    authenticated: token !== null,
    signedOut: token === null && tokenError !== null,
    connection,
    latencyMs,
    error,
    sessions,
    environments,
    activeId,
    setActiveId,
    active,
    send,
    respondPermission,
    createSession,
  }
}
