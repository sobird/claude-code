/**
 * CORS policy for the browser-facing `/web/*` routes.
 *
 * The UI authenticates with an `Authorization` header (access-token JWT), so only those
 * origins explicitly configured via `RCS_WEB_CORS_ORIGINS` are echoed back. With an empty
 * allowlist no `Access-Control-Allow-Origin` header is emitted at all — same-origin
 * requests keep working and nothing is opened to `*`.
 */

export interface WebCorsOptions {
  /** Echo the request origin only when it is allowlisted; otherwise emit no header. */
  origin: (origin: string) => string | undefined
  allowMethods: string[]
  allowHeaders: string[]
}

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
const ALLOWED_HEADERS = ['Authorization', 'Content-Type']

export function webCorsOptions(origins: string[]): WebCorsOptions {
  const allowlist = new Set(origins.map((origin) => origin.trim()).filter(Boolean))
  return {
    origin: (origin) => (allowlist.has(origin) ? origin : undefined),
    allowMethods: [...ALLOWED_METHODS],
    allowHeaders: [...ALLOWED_HEADERS],
  }
}
