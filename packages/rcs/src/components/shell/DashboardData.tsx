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
  /** True until the first load settles (success or failure). */
  loading: boolean
  error: string | null
  connection: ConnectionState
  refresh: () => void
  createSession: (input: CreateSessionInput) => Promise<CreatedSession>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')

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
      const [nextSessions, nextEnvironments] = await Promise.all([
        api.get<SessionSummary[]>('/web/sessions/all'),
        api.get<EnvironmentSummary[]>('/web/environments'),
      ])
      setSessions(Array.isArray(nextSessions) ? nextSessions : [])
      setEnvironments(Array.isArray(nextEnvironments) ? nextEnvironments : [])
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
      loading,
      error,
      connection,
      refresh,
      createSession,
    }),
    [sessions, environments, loading, error, connection, refresh, createSession],
  )

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>
}

export function useDashboardData(): DashboardDataValue {
  const context = useContext(DashboardDataContext)
  if (!context) throw new Error('useDashboardData must be used within a DashboardDataProvider')
  return context
}
