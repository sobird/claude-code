/**
 * V2 session-ingress transport for the bridge (legacy `/v2/session_ingress` namespace).
 *
 * `POST /session/:id/events` writes bridge events over plain HTTP; `/ws/:id` is the
 * WebSocket transport with durable replay. Both accept a worker token, the owning
 * environment token, or an owning API key (legacy `RCS_API_KEYS` included) and resolve the
 * `session_…` compatibility id to the canonical `cse_…` row.
 */

import { Hono } from 'hono'
import type { WSContext } from 'hono/ws'

import type { AppEnv } from '../../auth/context.js'
import { loadConfig } from '../../config.js'
import type { Repositories } from '../../db/repositories/types.js'
import {
  handleWebSocketClose,
  handleWebSocketMessage,
  handleWebSocketOpen,
  ingestBridgeMessage,
} from '../../transport/ws-handler.js'
import { handleSizedWsPayload, decodeWsPayload } from '../../transport/ws-payload.js'
import { upgradeWebSocket, websocket } from '../../transport/ws-shared.js'
import { legacySessionIngressAuth } from '../common.js'

const app = new Hono<AppEnv>()

/** POST /session/:id/events — hybrid transport bridge writes. */
app.post('/session/:id/events', legacySessionIngressAuth, async (c) => {
  const repos = c.get('repos')
  const sessionId = c.get('workerSessionId')

  const body: unknown = await c.req.json().catch(() => ({}))
  const direct = body as Record<string, unknown> | null
  const candidates: unknown =
    direct && Array.isArray(direct.events) ? direct.events : Array.isArray(body) ? body : [body]

  for (const raw of candidates as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    await ingestBridgeMessage(repos, sessionId, raw as Record<string, unknown>)
  }

  return c.json({ status: 'ok' }, 200)
})

/** GET /ws/:id — WebSocket transport with durable replay. */
app.get(
  '/ws/:id',
  legacySessionIngressAuth,
  upgradeWebSocket(async (c) => {
    const repos = c.get('repos')
    const sessionId = c.get('workerSessionId')
    const config = loadConfig()

    return {
      async onOpen(_event, ws) {
        await handleWebSocketOpen(repos, config, ws, sessionId)
      },
      onMessage(event, ws) {
        handleSessionIngressWsPayload(repos, ws, sessionId, event.data)
      },
      onClose(event, ws) {
        handleWebSocketClose(ws, sessionId, (event as { code?: number }).code, (event as { reason?: string }).reason)
      },
      onError(_event, ws) {
        console.error(`[ws] error on session=${sessionId}`)
        handleWebSocketClose(ws, sessionId, 1006, 'websocket error')
      },
    }
  }),
)

export const decodeSessionIngressWsMessage = decodeWsPayload

export function handleSessionIngressWsPayload(
  repos: Repositories,
  ws: WSContext,
  sessionId: string,
  payload: unknown,
): boolean {
  return handleSizedWsPayload(ws, '[ws]', `session=${sessionId}`, payload, (data) => {
    void handleWebSocketMessage(repos, ws, sessionId, data)
  })
}

export { websocket }
export default app
