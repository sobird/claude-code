'use client'

/**
 * Dashboard data provider.
 *
 * Owns the gateway polling loop shared by the dashboard, the navbar connection
 * badge, and the mobile session drawer. Data is fetched with the Task 15
 * token-aware client every 10 seconds; errors surface as an `ApiError` message
 * while stale data stays on screen.
 */

import { useTranslations } from 'next-intl'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ConnectionState } from '@/components/ui/ConnectionStatus'
import { useAccessToken } from '@/hooks/useAccessToken'
import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'
import { createApiClient } from '@/lib/api-client'
import { readSessionActivity, type SessionActivityItem } from '@/lib/session-activity'

import { ArchiveSessionDialog, type ArchiveSessionTarget } from './ArchiveSessionDialog'
import type { CreatedSession, EnvironmentSummary, SessionSummary } from './types'

const POLL_INTERVAL_MS = 10_000

export interface CreateSessionInput {
  title?: string
  environment_id?: string
  permission_mode?: string
}

interface DashboardDataValue {
  sessions: SessionSummary[]
  environments: EnvironmentSummary[]
  /** 已归档会话；成员只拿到自己拥有的，admin 拿到全部。 */
  archivedSessions: SessionSummary[]
  /** True until the first load settles (success or failure). */
  loading: boolean
  error: string | null
  connection: ConnectionState
  refresh: () => void
  createSession: (input: CreateSessionInput) => Promise<CreatedSession>
  /** 打开共享的归档弹窗；`onArchived` 在归档成功后执行（例如详情页翻转本地状态）。 */
  openArchive: (target: ArchiveSessionTarget, onArchived?: () => void) => void
  /** 恢复已归档会话；失败时抛出错误，由调用方按入口展示。 */
  restoreSession: (id: string) => Promise<void>
  /** 显式切换某会话的已读状态；成功后重新拉取列表。失败时抛出错误。 */
  setSessionRead: (id: string, action: 'read' | 'unread') => Promise<void>
}

const DashboardDataContext = createContext<DashboardDataValue | undefined>(undefined)

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const describeError = useApiErrorMessage()
  const tErrors = useTranslations('errors')
  const { token, refresh: refreshToken, error: tokenError } = useAccessToken()
  const tokenRef = useRef(token)
  const inFlightRef = useRef(false)

  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([])
  const [archivedSessions, setArchivedSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')

  const [archiveTarget, setArchiveTarget] = useState<ArchiveSessionTarget | null>(null)
  const [archiveActivity, setArchiveActivity] = useState<SessionActivityItem[] | null>(null)
  const [archivePending, setArchivePending] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const archiveDoneRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const api = useMemo(
    () =>
      createApiClient({
        getToken: () => tokenRef.current,
        refreshToken: refreshToken,
      }),
    [refreshToken],
  )

  const load = useCallback(async () => {
    if (tokenRef.current === null || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const [nextSessions, nextEnvironments, nextArchived] = await Promise.all([
        api.get<SessionSummary[]>('/web/sessions/all'),
        api.get<EnvironmentSummary[]>('/web/environments'),
        api.get<SessionSummary[]>('/web/sessions/archived'),
      ])
      setSessions(Array.isArray(nextSessions) ? nextSessions : [])
      setEnvironments(Array.isArray(nextEnvironments) ? nextEnvironments : [])
      setArchivedSessions(Array.isArray(nextArchived) ? nextArchived : [])
      setError(null)
      setConnection('connected')
    } catch (loadError) {
      setError(describeError(loadError, 'dashboard.loadError'))
      setConnection('error')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [api, describeError])

  const refresh = useCallback(() => {
    // Without a token the polling load is a no-op, so retry minting instead.
    if (tokenRef.current === null) {
      void refreshToken()
      return
    }
    void load()
  }, [load, refreshToken])

  const createSession = useCallback(
    async (input: CreateSessionInput): Promise<CreatedSession> => {
      const created = await api.post<CreatedSession>('/web/sessions', input)
      void load()
      return created
    },
    [api, load],
  )

  const restoreSession = useCallback(
    async (id: string): Promise<void> => {
      await api.post(`/web/sessions/${encodeURIComponent(id)}/unarchive`, {})
      void load()
    },
    [api, load],
  )

  const setSessionRead = useCallback(
    async (id: string, action: 'read' | 'unread'): Promise<void> => {
      await api.post(`/web/sessions/${encodeURIComponent(id)}/read`, { action })
      void load()
    },
    [api, load],
  )

  const openArchive = useCallback((target: ArchiveSessionTarget, onArchived?: () => void) => {
    archiveDoneRef.current = onArchived ?? null
    setArchiveTarget(target)
    setArchiveActivity(null)
    setArchiveError(null)
    setArchivePending(false)
  }, [])

  const closeArchive = useCallback(() => {
    archiveDoneRef.current = null
    setArchiveTarget(null)
    setArchiveActivity(null)
    setArchiveError(null)
  }, [])

  const submitArchive = useCallback(
    async (stopActivity: boolean): Promise<void> => {
      const target = archiveTarget
      if (!target) return
      setArchivePending(true)
      setArchiveError(null)
      try {
        await api.post(
          `/web/sessions/${encodeURIComponent(target.id)}/archive`,
          stopActivity ? { stop_activity: true } : {},
        )
        const done = archiveDoneRef.current
        archiveDoneRef.current = null
        setArchiveTarget(null)
        setArchiveActivity(null)
        done?.()
        void load()
      } catch (submitError) {
        // 409 session_active 变为“停止并归档”阶段；其他错误留在确认弹窗里。
        const activity = readSessionActivity(submitError)
        if (activity !== null) {
          setArchiveActivity(activity)
          return
        }
        setArchiveError(describeError(submitError, 'session.archive.failed'))
      } finally {
        setArchivePending(false)
      }
    },
    [api, archiveTarget, describeError, load],
  )

  useEffect(() => {
    if (token === null) {
      // The token hook reports failures once its first attempt settles; only
      // then surface an error, so the initial in-flight mint keeps the skeleton.
      if (tokenError !== null) {
        setError(tErrors('tokenUnavailable'))
        setConnection('error')
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
  }, [token, tokenError, load, tErrors])

  const value = useMemo<DashboardDataValue>(
    () => ({
      sessions,
      environments,
      archivedSessions,
      loading,
      error,
      connection,
      refresh,
      createSession,
      openArchive,
      restoreSession,
      setSessionRead,
    }),
    [
      sessions,
      environments,
      archivedSessions,
      loading,
      error,
      connection,
      refresh,
      createSession,
      openArchive,
      restoreSession,
      setSessionRead,
    ],
  )

  return (
    <DashboardDataContext.Provider value={value}>
      {children}
      <ArchiveSessionDialog
        target={archiveTarget}
        activity={archiveActivity}
        pending={archivePending}
        error={archiveError}
        onClose={closeArchive}
        onSubmit={(stopActivity) => void submitArchive(stopActivity)}
      />
    </DashboardDataContext.Provider>
  )
}

export function useDashboardData(): DashboardDataValue {
  const context = useContext(DashboardDataContext)
  if (!context) throw new Error('useDashboardData must be used within a DashboardDataProvider')
  return context
}
