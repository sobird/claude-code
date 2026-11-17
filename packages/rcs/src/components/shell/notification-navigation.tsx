'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Routes an already-running app to the session a push notification points at.
 *
 * The service worker navigates a running window itself; where that API is
 * unavailable (notably iOS home-screen apps, which can reopen at the start
 * URL), it posts this message instead and the SPA router takes over.
 */
export function NotificationNavigation(): null {
  const router = useRouter()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null
      if (data?.type !== 'notification:navigate' || typeof data.url !== 'string') return
      // The service worker is same-origin, but keep the router from following a
      // crafted absolute URL if one ever arrives.
      if (!data.url.startsWith('/')) return
      router.push(data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])

  return null
}
