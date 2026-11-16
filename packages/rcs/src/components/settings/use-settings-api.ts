'use client'

/**
 * Shared access-token + API client wiring for the settings and admin screens.
 *
 * One provider owns a single `useAccessToken` instance per page so sibling
 * panels share the token instead of each minting their own (the mint endpoint
 * is rate limited). The token-aware client reads the latest token from a ref
 * because the hook returns tokens asynchronously.
 */

import { createContext, createElement, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

import { useAccessToken } from '../../hooks/useAccessToken'
import { createApiClient, type ApiClient } from '../../lib/api-client'

export interface SettingsApi {
  api: ApiClient
  /** `null` until the first token mint settles (or when unauthenticated). */
  token: string | null
  tokenError: string | null
}

const SettingsApiContext = createContext<SettingsApi | undefined>(undefined)

export function SettingsApiProvider({ children }: { children: ReactNode }) {
  const { token, refresh, error } = useAccessToken()
  const tokenRef = useRef(token)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const api = useMemo(
    () =>
      createApiClient({
        getToken: () => tokenRef.current,
        refreshToken: refresh,
      }),
    [refresh],
  )

  const value = useMemo<SettingsApi>(() => ({ api, token, tokenError: error }), [api, token, error])

  return createElement(SettingsApiContext.Provider, { value }, children)
}

export function useSettingsApi(): SettingsApi {
  const context = useContext(SettingsApiContext)
  if (!context) throw new Error('useSettingsApi must be used within a SettingsApiProvider')
  return context
}
