/**
 * Browser-facing paths under the Next `basePath`.
 *
 * `basePath: '/code'` means every fetch and link must carry the prefix, while
 * route handlers see the URL with it stripped. Server-action `redirect()` adds
 * the base path back, so action targets must use the un-prefixed form.
 */

/** Next `basePath`; every browser-facing route is prefixed with it. */
export const APP_BASE_PATH = '/code'

/** Same-origin locale preference endpoint (browser-facing, includes `basePath`). */
export const PREFERENCES_PATH = `${APP_BASE_PATH}/api/preferences`

/**
 * Converts a browser-facing path into a server-action redirect target.
 *
 * Server-action `redirect()` re-adds `basePath`, so a prefixed path would
 * become `/code/code/...`. Un-prefixed paths pass through unchanged.
 */
export function toActionRedirectPath(value: string): string {
  if (value === APP_BASE_PATH) return '/'
  if (value.startsWith(`${APP_BASE_PATH}/`)) return value.slice(APP_BASE_PATH.length)
  return value
}
