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

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleRefresh = useCallback(
    (expiresAt: number) => {
      clearTimer()
      const delay = Math.max(0, expiresAt - Date.now() - REFRESH_MARGIN_MS)
      timerRef.current = setTimeout(() => {
        void refreshRef.current()
      }, delay)
    },
    [clearTimer],
  )

  const load = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(ACCESS_TOKEN_PATH, { method: 'POST' })
      if (!response.ok) {
        if (response.status === 401) {
          setToken(null)
          clearTimer()
        }
        return null
      }
      const body = (await response.json()) as AccessTokenResponse
      if (!mountedRef.current) return body.token
      const expiresAt = Date.now() + body.expiresIn * 1000
      setToken(body.token)
      scheduleRefresh(expiresAt)
      return body.token
    } catch {
      return null
    }
  }, [clearTimer, scheduleRefresh])

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
