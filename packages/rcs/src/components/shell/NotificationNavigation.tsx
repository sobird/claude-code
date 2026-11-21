'use client'

import { useEffect } from 'react'

import { clearPendingNavigation, takePendingNavigation } from '@/lib/pending-navigation'

const PENDING_RETRY_ATTEMPTS = 5
const PENDING_RETRY_DELAY_MS = 250

/** Full navigation, not `router.push`: the cold-start hand-off can arrive before hydration. */
function navigateTo(url: string): void {
  if (window.location.pathname === url) return
  window.location.assign(url)
}

/**
 * Routes the app to the session a push notification points at.
 *
 * The service worker steers a running window directly where it can. Where it
 * cannot — notably iOS home-screen apps, which relaunch at their start URL and
 * ignore `openWindow` URLs — it leaves an IndexedDB hand-off that this component
 * consumes on mount, on resume, and on the worker's postMessage fallback.
 */
export function NotificationNavigation(): null {
  useEffect(() => {
    const openPending = async () => {
      // Another window may own the hand-off; only the visible one consumes it.
      if (document.visibilityState !== 'visible') return
      // On iOS the app can boot before the worker finishes writing the target,
      // so give the hand-off a short window to appear rather than missing it.
      for (let attempt = 0; attempt < PENDING_RETRY_ATTEMPTS; attempt++) {
        const url = await takePendingNavigation()
        if (document.visibilityState !== 'visible') return
        if (url) {
          // Navigate even if this effect was re-mounted meanwhile: the first
          // (StrictMode) invocation may be the one that won the hand-off, and
          // dropping it there would lose the click.
          navigateTo(url)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, PENDING_RETRY_DELAY_MS))
      }
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null
      if (data?.type !== 'notification:navigate' || typeof data.url !== 'string') return
      // The service worker is same-origin, but keep the app from following a
      // crafted absolute URL if one ever arrives.
      if (!data.url.startsWith('/') || data.url.startsWith('//')) return
      void clearPendingNavigation()
      navigateTo(data.url)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void openPending()
    }

    void openPending()
    navigator.serviceWorker?.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [])

  return null
}
