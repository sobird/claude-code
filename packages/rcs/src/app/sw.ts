import { defaultCache } from '@serwist/turbopack/worker'
import { NetworkOnly, Serwist } from 'serwist'
import type { PrecacheEntry, RuntimeCaching } from 'serwist'

import { parseNotificationPayload, shouldShowNotification, toNotificationContent } from '../lib/notification-content.js'
import { clearPendingNavigation, setPendingNavigation } from '../lib/pending-navigation.js'

// The project's tsconfig uses the DOM lib, whose service-worker globals are
// limited; declare only the slice this entry reads. `__SW_MANIFEST` is
// injected by `@serwist/turbopack` when the worker is bundled at build time.
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[]
  addEventListener(type: 'push' | 'notificationclick', listener: (event: Event) => void): void
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> }
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<
      Array<{
        url: string
        visibilityState: string
        focus(): Promise<unknown>
        navigate(url: string): Promise<unknown>
        postMessage(message: unknown): void
      }>
    >
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

// `next dev` registers this worker too so push can be tested locally. Dev
// assets are hashed and unstable, so caching any of them would shadow HMR;
// in dev the worker handles no requests and only serves the push handlers.
const isDev = process.env.NODE_ENV !== 'production'

const serwist = new Serwist({
  precacheEntries: isDev ? [] : self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Network-only rules must come first: defaultCache falls through to a
  // NetworkFirst catch-all that would otherwise cache gateway responses.
  runtimeCaching: isDev ? networkOnly : [...networkOnly, ...defaultCache],
  ...(isDev
    ? {}
    : {
        fallbacks: {
          entries: [
            {
              url: OFFLINE_URL,
              matcher: ({ request }) => request.destination === 'document',
            },
          ],
        },
      }),
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
      try {
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
          // Android renders `badge` as a white alpha mask; iOS uses the app icon.
          badge: '/icons/icon-monochrome-512.png',
          data: { url: content.url },
        })
      } catch (error) {
        // Keep a failed `matchAll`/`showNotification` from becoming an unhandled
        // rejection; the notification is still skipped, but log it for DevTools.
        console.error('[rcs] push notification failed:', error)
      }
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
      try {
        // Record the target before touching windows: on iOS the tap may relaunch
        // the home-screen app at its start URL with no window to message, and
        // only the app itself can act on the hand-off once it boots.
        await setPendingNavigation(url)

        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const exact = windows.find((client) => new URL(client.url).pathname === url)
        if (exact) {
          await exact.focus()
          await clearPendingNavigation()
          return
        }
        // iOS often launches a home-screen app at its start URL and ignores the
        // URL passed to `openWindow`, so steer a running window directly. Fall
        // back to a router message where `navigate` is unavailable.
        const target = windows[0]
        if (target) {
          try {
            await target.navigate(url)
            await clearPendingNavigation()
          } catch {
            // Leave the hand-off in place: if the message is lost, the app still
            // picks the target up when it next becomes visible.
            target.postMessage({ type: 'notification:navigate', url })
          }
          await target.focus()
          return
        }
        // No window to steer: the launch below may land on the start URL, so
        // leave the hand-off for the app to consume on boot.
        await self.clients.openWindow(url)
      } catch (error) {
        // Keep a failed `matchAll`/`focus`/`navigate`/`openWindow` from becoming
        // an unhandled rejection; the click is still skipped, but log it for DevTools.
        console.error('[rcs] notification click failed:', error)
      }
    })(),
  )
})
