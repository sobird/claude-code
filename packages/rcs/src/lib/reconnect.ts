/**
 * SSE stream runner with token refresh and reconnect.
 *
 * Kept free of React so it can be unit tested with injected dependencies:
 * `fetch`, `sleep`, and timers are all supplied by the caller. Behaviour:
 *
 * - tracks the last seen event id and resumes with `Last-Event-ID`
 * - on `401` calls `refreshToken()` exactly once (a second consecutive 401
 *   surfaces an error instead of looping), then resumes immediately
 * - other failures back off exponentially (1s → 2s → 4s … capped at 30s)
 * - stops when the stream ends normally or the `AbortSignal` fires
 */

import { consumeSse, type SseEvent } from './sse-client'

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error'

export interface RunStreamDeps {
  /** Full SSE URL, e.g. `/web/sessions/:id/events`. */
  url: string
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  getToken: () => string | null | undefined
  refreshToken: () => Promise<string | null | undefined>
  onEvent?: (event: SseEvent) => void
  onStatus?: (status: StreamStatus) => void
  signal?: AbortSignal
  initialBackoffMs?: number
  maxBackoffMs?: number
}

export interface RunStreamResult {
  reconnects: number
  resumedFrom?: string
}

const DEFAULT_INITIAL_BACKOFF_MS = 1_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && err.name === 'AbortError'
}

function isAuthError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 401
}

/** Default sleep, exposed so browsers can import it without wiring timers. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runStreamWithRefresh(deps: RunStreamDeps): Promise<RunStreamResult> {
  const {
    url,
    fetch,
    sleep,
    refreshToken,
    onEvent,
    onStatus,
    signal,
    initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  } = deps

  let token = deps.getToken()
  let lastEventId: string | undefined
  let resumedFrom: string | undefined
  let reconnects = 0
  let backoff = initialBackoffMs
  // True once we have refreshed without an intervening successful open.
  let refreshedSinceOpen = false

  const finish = (status: StreamStatus): RunStreamResult => {
    onStatus?.(status)
    return { reconnects, resumedFrom }
  }

  const fail = (status: StreamStatus, error: Error): never => {
    onStatus?.(status)
    throw error
  }

  const headerFor = (): HeadersInit => {
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId
    return headers
  }

  onStatus?.('connecting')

  for (;;) {
    if (signal?.aborted) return finish('closed')

    let response: Response
    try {
      response = await fetch(url, { headers: headerFor(), signal })
    } catch (err) {
      if (isAbort(err)) return finish('closed')
      if (isAuthError(err)) {
        // A 401 surfaced while streaming behaves like a 401 response.
        const resume = await handleAuthFailure()
        if (resume.type === 'done') return resume.result
        continue
      }
      const next = await backoffAndReconnect()
      if (next.type === 'done') return next.result
      continue
    }

    if (response.status === 401) {
      const resume = await handleAuthFailure()
      if (resume.type === 'done') return resume.result
      continue
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return fail('error', new Error(`stream failed with HTTP ${response.status}`))
    }

    refreshedSinceOpen = false
    backoff = initialBackoffMs
    onStatus?.('open')

    try {
      await consumeSse(
        response,
        (event) => {
          if (event.id !== undefined) lastEventId = event.id
          onEvent?.(event)
        },
        signal,
      )
    } catch (err) {
      if (isAbort(err)) return finish('closed')
      if (isAuthError(err)) {
        const resume = await handleAuthFailure()
        if (resume.type === 'done') return resume.result
        continue
      }
      const next = await backoffAndReconnect()
      if (next.type === 'done') return next.result
      continue
    }

    return finish('closed')
  }

  /** Refresh once and resume from the last event id. */
  async function handleAuthFailure(): Promise<{ type: 'continue' } | { type: 'done'; result: RunStreamResult }> {
    if (refreshedSinceOpen) {
      return {
        type: 'done',
        result: fail('error', new Error('unauthorized: token refresh did not resolve the stream')),
      }
    }
    const refreshed = await refreshToken()
    refreshedSinceOpen = true
    if (!refreshed) {
      return {
        type: 'done',
        result: fail('error', new Error('unauthorized: could not refresh access token')),
      }
    }
    token = refreshed
    resumedFrom = lastEventId
    reconnects += 1
    onStatus?.('reconnecting')
    return { type: 'continue' }
  }

  /** Sleep with exponential backoff, then reconnect. */
  async function backoffAndReconnect(): Promise<{ type: 'continue' } | { type: 'done'; result: RunStreamResult }> {
    if (signal?.aborted) return { type: 'done', result: finish('closed') }
    onStatus?.('reconnecting')
    await sleep(backoff)
    if (signal?.aborted) return { type: 'done', result: finish('closed') }
    backoff = Math.min(backoff * 2, maxBackoffMs)
    resumedFrom = lastEventId
    reconnects += 1
    return { type: 'continue' }
  }
}
