import { createSerwistRoute } from '@serwist/turbopack'

/**
 * Serves the Serwist service worker and its chunks. Next serves this route at
 * `/code/serwist/sw.js` (basePath plus the `[path]` segment), so the worker is
 * registered with that URL and the `/code/` scope.
 *
 * The precache manifest is generated from `.next/static/**` and `public/**`
 * (which covers the manifest and icons); the offline page is added explicitly
 * because it is a prerendered route, not a static asset.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'src/app/sw.ts',
  useNativeEsbuild: false,
  // Object entries (rather than bare strings) carry an explicit `revision` so
  // the adapter does not emit its `string-entry-warning`.
  additionalPrecacheEntries: [{ url: '/code/~offline', revision: null }],
})
