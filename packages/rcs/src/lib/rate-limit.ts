/**
 * In-memory fixed-window rate limiter.
 *
 * Intended for the single-process Next server: each key (typically
 * `${ip}:${username}`) gets a counter that allows `limit` attempts inside a
 * `windowMs` window. The first `limit` checks in a window return `true`; the
 * next check flips the window's counter past the limit and returns `false`.
 * The window resets once `windowMs` has elapsed since it started.
 *
 * This is deliberately tiny: no timers, no background sweeps. Expired entries
 * are cleared lazily when the same key is checked again.
 */

export interface RateLimiterOptions {
  /** Maximum allowed checks per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimiter {
  /** Returns `true` when the check is allowed, `false` when the key is over limit. */
  check(key: string): boolean
}

interface WindowState {
  count: number
  resetAt: number
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, WindowState>()
  let lastSweep = Date.now()

  function sweep(now: number): void {
    // Avoid unbounded growth from one-off keys (e.g. rotating IPs) without a
    // timer: sweep expired windows at most once per window length.
    if (now - lastSweep < windowMs) return
    lastSweep = now
    for (const [key, state] of windows) {
      if (state.resetAt <= now) windows.delete(key)
    }
  }

  return {
    check(key: string): boolean {
      const now = Date.now()
      sweep(now)

      const current = windows.get(key)
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }

      current.count += 1
      return current.count <= limit
    },
  }
}
