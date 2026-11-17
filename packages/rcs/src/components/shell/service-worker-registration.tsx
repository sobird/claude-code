'use client'

import { useEffect } from 'react'

const SERVICE_WORKER_URL = '/serwist/sw.js'
const SERVICE_WORKER_SCOPE = '/'

/**
 * Registers the Serwist worker served by the `/serwist/[path]` route handler.
 * The route sets `Service-Worker-Allowed: /`, so the worker can claim the
 * origin-root scope even though its script lives one level deeper. Gateway
 * paths are marked network-only in the worker so it never caches them.
 *
 * Registration is client-only and production-only, so `next dev` is never
 * shadowed by a stale precache while iterating.
 */
export function ServiceWorkerRegistration(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE }).catch((error: unknown) => {
      // Browsers without support or insecure origins reject registration. Log
      // instead of surfacing an unhandled rejection; do not retry.
      console.warn('Service worker registration failed', error)
    })
  }, [])

  return null
}
