/**
 * ACP relay WebSocket (`/acp/relay/:agentId`).
 *
 * The web frontend connects with an access token (or API key) and is bridged to the
 * agent's `/acp/ws` connection through the channel-group `AcpEventBus`. The relay is
 * owner-scoped: the caller must own the target `acp` environment (admins bypass). A
 * non-owner is closed with 4003; 4004 stays reserved for a missing/offline agent after
 * ownership passes.
 */

import type { WSContext } from 'hono/ws'

import type { AuthUser } from '../auth/context.js'
import type { Repositories } from '../db/repositories/types.js'
import { findAcpConnectionByAgentId, sendToAgentWs } from './acp-ws-handler.js'
import { acpBusKey, getAcpEventBus } from './event-bus.js'
import type { SessionEvent } from './event-bus.js'

// Per-relay connection state
interface RelayConnectionEntry {
  agentId: string
  unsub: (() => void) | null
  keepalive: ReturnType<typeof setInterval> | null
  ws: WSContext
  openTime: number
}

const relayConnections = new Map<string, RelayConnectionEntry>() // key: relayWsId

const RELAY_KEEPALIVE_INTERVAL_MS = 20_000

/** Send a JSON message to relay WS. */
function sendToRelayWs(ws: WSContext, msg: object): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(msg))
  } catch (err) {
    console.error('[ACP-Relay] send error:', err)
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

/** Called from onOpen — verifies ownership, finds the target agent, and bridges. */
export async function handleRelayOpen(
  repos: Repositories,
  ws: WSContext,
  relayWsId: string,
  agentId: string,
  user: AuthUser,
): Promise<void> {
  console.log(`[ACP-Relay] Relay connection opened: relayWsId=${relayWsId} agentId=${agentId}`)

  const record = await repos.environments.getById(agentId)
  if (!record || record.workerType !== 'acp') {
    console.log(`[ACP-Relay] Agent ${agentId} not found`)
    sendToRelayWs(ws, { type: 'error', message: 'Agent not found or offline' })
    ws.close(4004, 'agent not found')
    return
  }

  // Ownership: only the owner (or an admin) may relay to this agent.
  if (user.role !== 'admin' && record.ownerUserId !== user.id) {
    console.log(`[ACP-Relay] Agent ${agentId} not owned by ${user.username}`)
    ws.close(4003, 'unauthorized')
    return
  }

  const agentConn = findAcpConnectionByAgentId(agentId)
  if (!agentConn) {
    console.log(`[ACP-Relay] Agent ${agentId} offline`)
    sendToRelayWs(ws, { type: 'error', message: 'Agent not found or offline' })
    ws.close(4004, 'agent not found')
    return
  }

  const keepalive = setInterval(() => {
    const entry = relayConnections.get(relayWsId)
    if (!entry || entry.ws.readyState !== 1) {
      clearInterval(keepalive)
      return
    }
    sendToRelayWs(entry.ws, { type: 'keep_alive' })
  }, RELAY_KEEPALIVE_INTERVAL_MS)
  unrefTimer(keepalive)

  // Subscribe to the channel group bus — forward agent responses to the frontend.
  // The bus is keyed by the agent's owner, not just the client-supplied group id.
  const channelGroupId = agentConn.channelGroupId
  const bus = getAcpEventBus(acpBusKey(record.ownerUserId ?? user.id, channelGroupId))
  const unsub = bus.subscribe((event: SessionEvent) => {
    if (ws.readyState !== 1) return
    if (event.direction !== 'inbound') return
    if (event.type === 'agent_disconnect') {
      sendToRelayWs(ws, { type: 'status', payload: { connected: false } })
      return
    }
    // Forward agent responses to the frontend WebSocket.
    sendToRelayWs(ws, event.payload as object)
  })

  relayConnections.set(relayWsId, {
    agentId,
    unsub,
    keepalive,
    ws,
    openTime: Date.now(),
  })

  // Don't send a synthetic status message here: the frontend sends a "connect" command,
  // which acp-link answers with a real status message including capabilities.
  console.log(`[ACP-Relay] Relay established: relayWsId=${relayWsId} → agentId=${agentId}`)
}

/** Called from onMessage — forwards frontend messages to acp-link. */
export function handleRelayMessage(ws: WSContext, relayWsId: string, data: string): void {
  const entry = relayConnections.get(relayWsId)
  if (!entry) return

  const lines = data.split('\n').filter((line) => line.trim())
  for (const line of lines) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('[ACP-Relay] parse error:', line)
      continue
    }

    // Ignore keepalive responses.
    if (msg.type === 'keep_alive') continue

    const sent = sendToAgentWs(entry.agentId, msg)
    if (!sent) {
      sendToRelayWs(ws, { type: 'error', message: 'Agent connection lost' })
      return
    }
  }
}

/** Called from onClose — cleans up relay connection. */
export function handleRelayClose(ws: WSContext, relayWsId: string, code?: number, reason?: string): void {
  void ws
  const entry = relayConnections.get(relayWsId)
  if (!entry) return

  const duration = Math.round((Date.now() - entry.openTime) / 1000)
  console.log(
    `[ACP-Relay] Connection closed: relayWsId=${relayWsId} agentId=${entry.agentId} code=${code ?? 'none'} reason=${reason || '(none)'} duration=${duration}s`,
  )

  if (entry.unsub) entry.unsub()
  if (entry.keepalive) clearInterval(entry.keepalive)

  relayConnections.delete(relayWsId)
}

/** Close all relay connections (for graceful shutdown). */
export function closeAllRelayConnections(): void {
  if (relayConnections.size === 0) return

  console.log(`[ACP-Relay] Closing ${relayConnections.size} relay connection(s)...`)
  for (const entry of relayConnections.values()) {
    try {
      if (entry.unsub) entry.unsub()
      if (entry.keepalive) clearInterval(entry.keepalive)
      if (entry.ws.readyState === 1) {
        entry.ws.close(1001, 'server_shutdown')
      }
    } catch {
      // ignore errors during shutdown
    }
  }
  relayConnections.clear()
  console.log('[ACP-Relay] All relay connections closed')
}
