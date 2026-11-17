import { defaultCache } from '@serwist/turbopack/worker'
import { NetworkOnly, Serwist } from 'serwist'
import type { PrecacheEntry, RuntimeCaching } from 'serwist'

// The project's tsconfig uses the DOM lib, whose service-worker globals are
// limited; declare only the slice this entry reads. `__SW_MANIFEST` is
// injected by `@serwist/turbopack` when the worker is bundled at build time.
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[]
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
