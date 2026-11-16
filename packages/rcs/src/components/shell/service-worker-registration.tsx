'use client'

import { useEffect } from 'react'

const SERVICE_WORKER_URL = '/code/serwist/sw.js'
const SERVICE_WORKER_SCOPE = '/code/'

/**
 * Registers the Serwist worker served by the `/code/serwist/[path]` route
 * handler. The route sets `Service-Worker-Allowed: /`, so the worker can claim
 * the whole `/code/` app scope even though its script lives one level deeper.
 *
 * Registration is client-only and production-only, so `next dev` is never
 * shadowed by a stale precache while iterating.
 */
export function ServiceWorkerRegistration(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE }).catch(() => {
      // Browsers without support or insecure origins reject registration.
    })
  }, [])

  return null
}
