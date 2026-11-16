/**
 * The single sanctioned Bun boundary for WebSocket support (R4).
 *
 * This is the only module under `src/{services,transport,routes,auth,db}` allowed to import
 * `hono/bun`; it re-exports `upgradeWebSocket` and `websocket` so route modules stay
 * runtime-neutral. Next.js code must never import this file.
 */

export { upgradeWebSocket, websocket } from 'hono/bun'
