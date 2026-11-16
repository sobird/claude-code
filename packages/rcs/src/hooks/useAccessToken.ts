'use client'

/**
 * Fetches and refreshes the gateway access token.
 *
 * The minting endpoint is rate limited (5/min per ip+username), so it is called
 * once on mount and again only shortly before expiry (~60s early) or on demand
 * via `refresh()`. A `401` clears the token; redirecting is left to the page or
 * middleware.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const ACCESS_TOKEN_PATH = '/code/api/access-token'
const REFRESH_MARGIN_MS = 60_000
const DEFAULT_EXPIRES_IN_SECONDS = 300
// setTimeout fires immediately for delays above a signed 32-bit int.
const MAX_TIMEOUT_MS = 2_147_483_647

interface AccessTokenResponse {
  token: string
  expiresIn: number
}

export interface UseAccessTokenResult {
  token: string | null
  /** Re-fetch now; resolves with the fresh token (or `null` when unauthenticated). */
  refresh: () => Promise<string | null>
}

export function useAccessToken(): UseAccessTokenResult {
  const [token, setToken] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const refreshRef = useRef<() => Promise<string | null>>(async () => null)
  // Shared by the timer and on-demand `refresh()` so they never fire two
  // concurrent minting requests (the endpoint is rate limited).
  const inFlightRef = useRef<Promise<string | null> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleRefresh = useCallback(
    (expiresAt: number) => {
      clearTimer()
      const remaining = expiresAt - Date.now() - REFRESH_MARGIN_MS
      const delay = Number.isFinite(remaining) ? Math.min(Math.max(0, remaining), MAX_TIMEOUT_MS) : 0
      timerRef.current = setTimeout(() => {
        void refreshRef.current()
      }, delay)
    },
    [clearTimer],
  )

  const fetchToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(ACCESS_TOKEN_PATH, { method: 'POST' })
      if (!response.ok) {
        if (response.status === 401) {
          setToken(null)
          clearTimer()
        }
        return null
      }
      const body = (await response.json()) as Partial<AccessTokenResponse>
      const nextToken = typeof body.token === 'string' && body.token.length > 0 ? body.token : null
      if (!nextToken) return null
      const rawExpiresIn = body.expiresIn
      const expiresIn =
        typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn) && rawExpiresIn > 0
          ? rawExpiresIn
          : DEFAULT_EXPIRES_IN_SECONDS
      if (!mountedRef.current) return nextToken
      setToken(nextToken)
      scheduleRefresh(Date.now() + expiresIn * 1000)
      return nextToken
    } catch {
      return null
    }
  }, [clearTimer, scheduleRefresh])

  const load = useCallback((): Promise<string | null> => {
    const pending = inFlightRef.current
    if (pending) return pending
    const request = fetchToken()
    inFlightRef.current = request
    void request.finally(() => {
      if (inFlightRef.current === request) inFlightRef.current = null
    })
    return request
  }, [fetchToken])

  useEffect(() => {
    refreshRef.current = load
  }, [load])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [clearTimer, load])

  const refresh = useCallback(async (): Promise<string | null> => load(), [load])

  return { token, refresh }
}
