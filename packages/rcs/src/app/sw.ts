import { defaultCache } from '@serwist/turbopack/worker'
import { NetworkOnly, Serwist } from 'serwist'
import type { PrecacheEntry, RuntimeCaching } from 'serwist'

import { parseNotificationPayload, shouldShowNotification, toNotificationContent } from '../lib/notification-content.js'

// The project's tsconfig uses the DOM lib, whose service-worker globals are
// limited; declare only the slice this entry reads. `__SW_MANIFEST` is
// injected by `@serwist/turbopack` when the worker is bundled at build time.
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[]
  addEventListener(type: 'push' | 'notificationclick', listener: (event: Event) => void): void
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> }
  clients: {
    matchAll(options: {
      type: 'window'
      includeUncontrolled: boolean
    }): Promise<Array<{ url: string; visibilityState: string; focus(): Promise<unknown> }>>
    openWindow(url: string): Promise<unknown>
  }
  navigator: { language: string }
}

// The DOM lib lacks the service-worker event shapes; model just the fields the
// handlers read and cast at the boundary.
interface PushEventLike {
  data: { json(): unknown } | null
  waitUntil(promise: Promise<unknown>): void
}

interface NotificationClickEventLike {
  notification: { close(): void; data?: { url?: string } }
  waitUntil(promise: Promise<unknown>): void
}

const OFFLINE_URL = '/~offline'

/**
 * Gateway endpoints stream or mutate state; they must never be served from the
 * cache. This also covers dev, where these paths proxy to the gateway, and
 * `/health`, which the proxy routes to the gateway on the same origin.
 */
const NETWORK_ONLY_PATHS = ['/web', '/v1', '/v2', '/acp', '/api', '/health']

const networkOnly: RuntimeCaching[] = NETWORK_ONLY_PATHS.map((path) => ({
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith(path),
  handler: new NetworkOnly(),
}))

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Network-only rules must come first: defaultCache falls through to a
  // NetworkFirst catch-all that would otherwise cache gateway responses.
  runtimeCaching: [...networkOnly, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: OFFLINE_URL,
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
})

serwist.addEventListeners()

function workerLocale(): 'en' | 'zh-CN' {
  return self.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

self.addEventListener('push', (event: Event) => {
  const push = event as unknown as PushEventLike
  if (!push.data) return

  let raw: unknown
  try {
    raw = push.data.json()
  } catch {
    return
  }

  const payload = parseNotificationPayload(raw)
  if (!payload) return

  push.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const visiblePaths = windows
        .filter((client) => client.visibilityState === 'visible')
        .map((client) => new URL(client.url).pathname)
      if (!shouldShowNotification(visiblePaths, payload.sessionId)) return

      const content = toNotificationContent(payload, workerLocale())
      await self.registration.showNotification(content.title, {
        body: content.body,
        tag: content.tag,
        icon: '/icons/icon-192.png',
        data: { url: content.url },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event: Event) => {
  const click = event as unknown as NotificationClickEventLike
  click.notification.close()

  const url = click.notification.data?.url
  if (!url) return

  click.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).pathname === url) {
          await client.focus()
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
