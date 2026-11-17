/**
 * Browser-facing paths.
 *
 * The UI is served from the origin root. The reverse proxy (Caddy in
 * production, Next rewrites in dev) carves out the gateway's protocol prefixes
 * (`/v1`, `/v2`, `/acp`, `/web`, `/api/oauth`, `/health`) before a request can
 * reach Next, so UI routes never need a base path.
 */

/** Same-origin locale preference endpoint. */
export const PREFERENCES_PATH = '/api/preferences'
