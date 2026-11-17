import { createSerwistRoute } from '@serwist/turbopack'

/**
 * Serves the Serwist service worker and its chunks. Next serves this route at
 * `/serwist/sw.js` (the `[path]` segment), so the worker is registered with
 * that URL and the origin-root scope.
 *
 * The precache manifest is generated from `.next/static/**` and `public/**`
 * (which covers the manifest and icons); the offline page is added explicitly
 * because it is a prerendered route, not a static asset.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'src/app/sw.ts',
  useNativeEsbuild: false,
  // The worker branches on NODE_ENV (dev disables caching); esbuild runs in a
  // browser target where `process` does not exist, so inline the value.
  esbuildOptions: {
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development') },
  },
  // Object entries (rather than bare strings) carry an explicit `revision` so
  // the adapter does not emit its `string-entry-warning`.
  additionalPrecacheEntries: [{ url: '/~offline', revision: null }],
})
