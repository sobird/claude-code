'use client'

/**
 * Reads the app-wide gateway access token.
 *
 * The token is a single shared value per browser tab: every `useAccessToken()`
 * caller subscribes to one module-level store, so mounting several consumers
 * (dashboard provider, session view, SSE stream) mints exactly one token. The
 * minting endpoint is rate limited (5/min per ip+username), so the initial mint
 * runs once and the shared store refreshes shortly before expiry (~60s early),
 * deduping concurrent requests. A `401` clears the token; redirecting is left to
 * the page or middleware.
 */

import { useEffect, useSyncExternalStore } from 'react'

import { createAccessTokenStore, type AccessTokenSnapshot, type TokenMintResult } from '../lib/token-store'

const ACCESS_TOKEN_PATH = '/code/api/access-token'
const DEFAULT_EXPIRES_IN_SECONDS = 300

interface AccessTokenResponse {
  token: string
  expiresIn: number
}

export interface UseAccessTokenResult {
  token: string | null
  /** Re-fetch now; resolves with the fresh token (or `null` when unauthenticated). */
  refresh: () => Promise<string | null>
  /**
   * Message from the last failed minting attempt, or `null` while the latest
   * attempt succeeded or is still in flight. A `401` reports `'Not signed in'`.
   */
  error: string | null
}

/** Pull a readable message out of a gateway error body; falls back to the status. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
    if (body.error && typeof body.error === 'object') {
      const message = (body.error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
    if (typeof body.message === 'string' && body.message.length > 0) return body.message
  } catch {
    // Non-JSON body: fall through to the status line.
  }
  return response.statusText || `Access token request failed (HTTP ${response.status})`
}

/** Mint a token from the gateway, mapping every outcome to a `TokenMintResult`. */
async function mintAccessToken(): Promise<TokenMintResult> {
  try {
    const response = await fetch(ACCESS_TOKEN_PATH, { method: 'POST' })
    if (!response.ok) {
      return { ok: false, status: response.status, message: await readErrorMessage(response) }
    }
    const body = (await response.json()) as Partial<AccessTokenResponse>
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return { ok: false, status: response.status, message: 'Access token response was empty' }
    }
    const rawExpiresIn = body.expiresIn
    const expiresIn =
      typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn) && rawExpiresIn > 0
        ? rawExpiresIn
        : DEFAULT_EXPIRES_IN_SECONDS
    return { ok: true, token: body.token, expiresIn }
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      message: cause instanceof Error && cause.message ? cause.message : 'Unable to reach the gateway',
    }
  }
}

const SERVER_SNAPSHOT: AccessTokenSnapshot = { token: null, error: null }

function getServerSnapshot(): AccessTokenSnapshot {
  return SERVER_SNAPSHOT
}

const store = createAccessTokenStore({ mint: mintAccessToken })

/** Kick off the initial mint exactly once for the lifetime of the tab. */
let started = false
function startOnce(): void {
  if (started) return
  started = true
  void store.ensureLoaded()
}

function refresh(): Promise<string | null> {
  return store.refresh()
}

export function useAccessToken(): UseAccessTokenResult {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot)

  useEffect(() => {
    startOnce()
  }, [])

  return { token: snapshot.token, refresh, error: snapshot.error }
}
