/**
 * In-flight broker for server→bridge control requests.
 *
 * Most control traffic is durable: it is persisted as an outbound event and replayed on
 * reconnect. High-frequency, throwaway traffic (`@` file completion) must not create rows,
 * so those requests are written straight to the live socket and matched against the
 * child's `control_response` by `request_id` here. A response that no waiter claims falls
 * through to the normal persisted-event path in `ingestBridgeMessage`.
 */

import type { ModelOption } from '../lib/model-settings.js'
import { normalizeModelOptions } from '../lib/model-settings.js'

/** Paths returned to the web client per completion query. */
export const MAX_SUGGESTION_PATHS = 20

/** How long the gateway waits for the bridge before answering with an empty list. */
export const BRIDGE_CONTROL_TIMEOUT_MS = 4000

interface Waiter {
  resolve: (response: Record<string, unknown> | null) => void
  timer: ReturnType<typeof setTimeout>
  /** Detach from the session map when the promise settles either way. */
  cleanup: () => void
}

const waitersBySession = new Map<string, Map<string, Waiter>>()

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

/**
 * Register a waiter for `requestId` before the caller writes the request. Resolves with the
 * child's `control_response` payload, or `null` when the timeout elapses first.
 */
export function requestBridgeControl(
  sessionId: string,
  requestId: string,
  request: Record<string, unknown>,
  timeoutMs = BRIDGE_CONTROL_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  void request
  let waiters = waitersBySession.get(sessionId)
  if (!waiters) {
    waiters = new Map()
    waitersBySession.set(sessionId, waiters)
  }
  // A duplicate id would leak its timer; settle the older one empty.
  waiters.get(requestId)?.resolve(null)

  return new Promise((resolve) => {
    const cleanup = (): void => {
      const current = waitersBySession.get(sessionId)
      if (!current || current.get(requestId) !== waiter) return
      current.delete(requestId)
      if (current.size === 0) waitersBySession.delete(sessionId)
    }
    const waiter: Waiter = {
      resolve: (response) => {
        clearTimeout(waiter.timer)
        cleanup()
        resolve(response)
      },
      timer: setTimeout(() => waiter.resolve(null), Math.max(0, timeoutMs)),
      cleanup,
    }
    unrefTimer(waiter.timer)
    waiters.set(requestId, waiter)
  })
}

/**
 * Resolve the waiter for an inbound `control_response`. Returns true when the response was
 * claimed (and must therefore not be persisted or fanned out).
 */
export function settleBridgeResponse(sessionId: string, response: Record<string, unknown>): boolean {
  const requestId = response.request_id
  if (typeof requestId !== 'string' || !requestId) return false
  const waiter = waitersBySession.get(sessionId)?.get(requestId)
  if (!waiter) return false
  waiter.resolve(response)
  return true
}

/**
 * Drop a request that was never written (e.g. the bridge socket was not connected).
 * Resolves it with `null` so the awaiting caller settles instead of leaking its timer.
 */
export function cancelBridgeRequest(sessionId: string, requestId: string): void {
  waitersBySession.get(sessionId)?.get(requestId)?.resolve(null)
}

/**
 * Resolve every pending request for a session with `null`. Called when the bridge socket
 * goes away so callers fail fast instead of waiting out their timeout.
 */
export function clearBridgeResponses(sessionId: string): void {
  const waiters = waitersBySession.get(sessionId)
  if (!waiters) return
  waitersBySession.delete(sessionId)
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer)
    waiter.resolve(null)
  }
}

/** Pull the path list out of a `file_suggestions` control response, defensively. */
export function suggestionPathsFromResponse(response: unknown): string[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return []
  const record = response as Record<string, unknown>
  if (record.subtype !== 'success') return []
  const payload = record.response
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const suggestions = (payload as Record<string, unknown>).suggestions
  if (!Array.isArray(suggestions)) return []

  const paths: string[] = []
  const seen = new Set<string>()
  for (const entry of suggestions) {
    if (typeof entry !== 'string') continue
    const path = entry.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= MAX_SUGGESTION_PATHS) break
  }
  return paths
}

/** Pull the model list out of an `initialize` control response, defensively. */
export function modelOptionsFromResponse(response: unknown): ModelOption[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return []
  const record = response as Record<string, unknown>
  if (record.subtype !== 'success') return []
  const payload = record.response
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  return normalizeModelOptions((payload as Record<string, unknown>).models)
}
