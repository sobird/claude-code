/**
 * Per-session cache of the CLI's model list.
 *
 * The list comes from a server-initiated `initialize` control request, which the
 * CLI answers only once — a second call fails with "Already initialized". Cache
 * successful replies for the life of the bridge connection, dedupe concurrent
 * fetches, and drop the cache when the socket goes away.
 */

import type { ModelOption } from '@/lib/model-settings'

const cache = new Map<string, ModelOption[]>()
const inflight = new Map<string, Promise<ModelOption[]>>()
// Identifies the fetch that owns a session's in-flight entry, so a disconnect
// mid-flight (which clears it) does not let the stale result populate the cache.
const inflightToken = new Map<string, symbol>()

export function getCachedModels(sessionId: string): ModelOption[] | null {
  return cache.get(sessionId) ?? null
}

export function clearModelCatalog(sessionId: string): void {
  cache.delete(sessionId)
  inflight.delete(sessionId)
  inflightToken.delete(sessionId)
}

/**
 * Return the cached list, join an in-flight fetch, or run `fetchModels`. A `null`
 * result means the bridge was unreachable or timed out and must not be cached,
 * so a later open can retry.
 */
export function loadModelCatalog(
  sessionId: string,
  fetchModels: () => Promise<ModelOption[] | null>,
): Promise<ModelOption[]> {
  const cached = cache.get(sessionId)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(sessionId)
  if (running) return running

  const token = Symbol('model-catalog')
  const promise = (async (): Promise<ModelOption[]> => {
    const models = await fetchModels()
    // A disconnect while the request was in flight cleared the entry; serve the
    // result to this caller but do not cache it against a new connection.
    if (inflightToken.get(sessionId) === token) {
      inflightToken.delete(sessionId)
      inflight.delete(sessionId)
      if (models) cache.set(sessionId, models)
    }
    return models ?? []
  })()
  inflight.set(sessionId, promise)
  inflightToken.set(sessionId, token)
  return promise
}
