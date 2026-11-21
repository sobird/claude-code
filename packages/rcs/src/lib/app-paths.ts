/**
 * Browser-facing paths.
 *
 * The UI is served from the origin root. In production Caddy carves out the
 * gateway's protocol prefixes (`/v1`, `/v2`, `/acp`, `/web`, `/api/oauth`,
 * `/health`) before a request can reach Next, so UI routes never need a base
 * path. In dev the client calls the gateway on `:4000` directly.
 */

/** Same-origin locale preference endpoint. */
export const PREFERENCES_PATH = '/api/preferences'
