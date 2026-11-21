'use client'

/**
 * Shared access-token wiring for the settings and admin screens.
 *
 * One provider owns a single `useAccessToken` instance per page so sibling
 * panels share the token instead of each minting their own (the mint endpoint
 * is rate limited). Consumers build their own API client keyed on `token` so
 * requests always carry the current token.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'

import { useAccessToken } from '@/hooks/useAccessToken'

export interface SettingsApi {
  /** `null` until the first token mint settles (or when unauthenticated). */
  token: string | null
  tokenError: string | null
  refresh: () => Promise<string | null>
}

const SettingsApiContext = createContext<SettingsApi | undefined>(undefined)

export function SettingsApiProvider({ children }: { children: ReactNode }) {
  const { token, refresh, error } = useAccessToken()

  const value = useMemo<SettingsApi>(() => ({ token, tokenError: error, refresh }), [token, error, refresh])

  return createElement(SettingsApiContext.Provider, { value }, children)
}

export function useSettingsApi(): SettingsApi {
  const context = useContext(SettingsApiContext)
  if (!context) throw new Error('useSettingsApi must be used within a SettingsApiProvider')
  return context
}
