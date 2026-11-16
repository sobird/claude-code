/**
 * Framework-free access-token store.
 *
 * The gateway access token is short lived and costly to mint: the minting
 * endpoint is rate limited (5/min per ip+username). A single store instance is
 * shared by every `useAccessToken()` caller so the whole app mints once and
 * reuses the same value, instead of each hook instance firing its own request.
 *
 * Every dependency (`mint`, clock, timer scheduling) is injectable so the store
 * can be unit tested without real timers or network access.
 */

export type TokenMintResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; status: number; message: string }

export interface AccessTokenSnapshot {
  token: string | null
  error: string | null
}

export interface AccessTokenStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => AccessTokenSnapshot
  /** Start the initial mint once; joins any in-flight request. */
  ensureLoaded: () => Promise<string | null>
  /** Force a mint now (401 recovery, manual refresh); joins in-flight. */
  refresh: () => Promise<string | null>
}

export interface CreateAccessTokenStoreOptions {
  mint: () => Promise<TokenMintResult>
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
  /** Start refreshing this long before the token expires. */
  refreshMarginMs?: number
  /** Fallback TTL when a mint reports a non-positive or non-finite value. */
  defaultExpiresInSeconds?: number
}

export function createAccessTokenStore(options: CreateAccessTokenStoreOptions): AccessTokenStore {
  const {
    mint,
    now = () => Date.now(),
    schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    refreshMarginMs = 60_000,
    defaultExpiresInSeconds = 300,
  } = options

  const listeners = new Set<() => void>()

  let snapshot: AccessTokenSnapshot = { token: null, error: null }
  let expiresAt = 0
  let timerHandle: unknown = null
  let inFlight: Promise<string | null> | null = null

  /** Swap in a new snapshot only when the values actually changed. */
  function setSnapshot(token: string | null, error: string | null): void {
    if (snapshot.token === token && snapshot.error === error) return
    snapshot = { token, error }
    for (const listener of listeners) listener()
  }

  function clearTimer(): void {
    if (timerHandle !== null) {
      cancel(timerHandle)
      timerHandle = null
    }
  }

  function scheduleRefresh(): void {
    clearTimer()
    const remaining = expiresAt - now() - refreshMarginMs
    const delay = Number.isFinite(remaining) ? Math.max(0, remaining) : 0
    timerHandle = schedule(() => {
      // The fired timer is spent; drop the handle so it is not cancelled twice.
      timerHandle = null
      void startMint()
    }, delay)
  }

  async function doMint(): Promise<string | null> {
    let result: TokenMintResult
    try {
      result = await mint()
    } catch (cause) {
      // `mint` is expected to map failures, but stay defensive.
      setSnapshot(
        snapshot.token,
        cause instanceof Error && cause.message ? cause.message : 'Unable to mint access token',
      )
      return null
    }

    if (!result.ok) {
      if (result.status === 401) {
        clearTimer()
        setSnapshot(null, 'Not signed in')
        return null
      }
      // Keep the existing token; a transient failure should not drop auth.
      setSnapshot(snapshot.token, result.message)
      return null
    }

    const expiresIn =
      Number.isFinite(result.expiresIn) && result.expiresIn > 0 ? result.expiresIn : defaultExpiresInSeconds
    expiresAt = now() + expiresIn * 1000
    setSnapshot(result.token, null)
    scheduleRefresh()
    return result.token
  }

  function startMint(): Promise<string | null> {
    if (inFlight) return inFlight
    const request = doMint()
    inFlight = request
    void request.finally(() => {
      if (inFlight === request) inFlight = null
    })
    return request
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return snapshot
    },
    ensureLoaded() {
      if (inFlight) return inFlight
      // Reuse a cached token only while it is comfortably before expiry.
      if (snapshot.token !== null && now() < expiresAt - refreshMarginMs) {
        return Promise.resolve(snapshot.token)
      }
      return startMint()
    },
    refresh() {
      return startMint()
    },
  }
}
