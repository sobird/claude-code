/**
 * ACP agent WebSocket transport (`/acp/ws`).
 *
 * Each connection is either registered inline (legacy `register` message, which creates an
 * `acp` environment owned by the authenticated user) or bound by `identify` to an
 * environment previously registered over REST. `identify` is owner-scoped: the target must
 * be an `acp` environment owned by the connection's user (admins bypass) so a member cannot
 * hijack another member's agent — failures reply `Agent not found` without binding.
 *
 * Channel-group traffic flows through the in-memory `AcpEventBus` (no DB persistence).
 */

import { randomUUID } from 'node:crypto'

import type { WSContext } from 'hono/ws'

import type { AuthUser } from '../auth/context.js'
import { loadConfig } from '../config.js'
import type { EnvironmentRecord } from '../contracts.js'
import type { Repositories } from '../db/repositories/types.js'
import { getAcpEventBus } from './event-bus.js'
import type { SessionEvent } from './event-bus.js'

// Per-connection state
interface AcpConnectionEntry {
  agentId: string | null // Set after register/identify
  /** Synchronous in-flight guard: a register/identify is awaiting the DB. */
  binding: boolean
  channelGroupId: string
  user: AuthUser
  unsub: (() => void) | null
  keepalive: ReturnType<typeof setInterval> | null
  ws: WSContext
  openTime: number
  lastClientActivity: number
  capabilities: Record<string, unknown> | null
}

const connections = new Map<string, AcpConnectionEntry>() // key: wsId

/** Send a JSON message to a WS connection (NDJSON format). */
function sendToWs(ws: WSContext, msg: object): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(msg) + '\n')
  } catch (err) {
    console.error('[ACP-WS] send error:', err)
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

function canAccessAgent(user: AuthUser, record: EnvironmentRecord): boolean {
  return user.role === 'admin' || record.ownerUserId === user.id
}

/** Subscribe the connection to outbound events of its channel group. */
function bindChannelGroup(entry: AcpConnectionEntry): void {
  const bus = getAcpEventBus(entry.channelGroupId)
  entry.unsub = bus.subscribe((event: SessionEvent) => {
    if (entry.ws.readyState !== 1) return
    if (event.direction !== 'outbound') return
    // Forward outbound events as raw ACP messages.
    sendToWs(entry.ws, event.payload as object)
  })
}

/** Called from onOpen — initializes connection tracking. */
export function handleAcpWsOpen(repos: Repositories, ws: WSContext, wsId: string, user: AuthUser): void {
  void repos // connection bookkeeping is repositories-independent until register/identify
  const config = loadConfig()
  const keepaliveIntervalMs = config.wsKeepaliveInterval * 1000
  const clientActivityTimeoutMs = keepaliveIntervalMs * 3

  const keepalive = setInterval(() => {
    const entry = connections.get(wsId)
    if (!entry || entry.ws.readyState !== 1) {
      clearInterval(keepalive)
      return
    }
    const silenceMs = Date.now() - entry.lastClientActivity
    if (silenceMs > clientActivityTimeoutMs) {
      console.error(`[ACP-WS] Client inactive for ${Math.round(silenceMs / 1000)}s, closing dead connection`)
      try {
        entry.ws.close(1000, 'client inactive')
      } catch {
        clearInterval(keepalive)
      }
      return
    }
    sendToWs(entry.ws, { type: 'keep_alive' })
  }, keepaliveIntervalMs)
  unrefTimer(keepalive)

  connections.set(wsId, {
    agentId: null,
    binding: false,
    channelGroupId: '',
    user,
    unsub: null,
    keepalive,
    ws,
    openTime: Date.now(),
    lastClientActivity: Date.now(),
    capabilities: null,
  })
}

/** Handle register message — legacy WS-only registration (still supported). */
async function handleRegister(
  repos: Repositories,
  entry: AcpConnectionEntry,
  msg: Record<string, unknown>,
): Promise<void> {
  // Synchronous guard: `agentId` is set only after an await, so check and claim the
  // in-flight flag before touching the DB. Otherwise two frames in one payload both
  // pass a bare `agentId` check and bind twice (leaking a bus subscription).
  if (entry.agentId || entry.binding) {
    sendToWs(entry.ws, { type: 'error', message: 'Already registered' })
    return
  }
  entry.binding = true

  try {
    const agentName = (msg.agent_name as string) || 'unknown'
    const capabilities = msg.capabilities as Record<string, unknown> | undefined
    const channelGroupId = (msg.channel_group_id as string) || `group_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const maxSessions = typeof msg.max_sessions === 'number' ? msg.max_sessions : 1

    const record = await repos.environments.create({
      ownerUserId: entry.user.id,
      machineName: agentName,
      workerType: 'acp',
      bridgeId: channelGroupId,
      maxSessions,
      capabilities: capabilities || null,
      status: 'active',
      lastPollAt: new Date(),
    })

    entry.agentId = record.id
    entry.channelGroupId = channelGroupId
    entry.capabilities = capabilities || null
    bindChannelGroup(entry)

    console.log(
      `[ACP-WS] Agent registered (legacy WS): agentId=${record.id} channelGroup=${channelGroupId} name=${agentName}`,
    )
    sendToWs(entry.ws, {
      type: 'registered',
      agent_id: record.id,
      channel_group_id: channelGroupId,
    })
  } finally {
    // Release the in-flight flag on failure so a transient DB error can be retried.
    if (!entry.agentId) entry.binding = false
  }
}

/** Handle identify message — binds WS to an existing agent registered via REST. */
async function handleIdentify(
  repos: Repositories,
  entry: AcpConnectionEntry,
  msg: Record<string, unknown>,
): Promise<void> {
  // See handleRegister: claim the in-flight flag synchronously before the first await.
  if (entry.agentId || entry.binding) {
    sendToWs(entry.ws, { type: 'error', message: 'Already identified' })
    return
  }
  entry.binding = true

  try {
    const agentId = msg.agent_id as string
    if (!agentId) {
      sendToWs(entry.ws, { type: 'error', message: 'Missing agent_id' })
      return
    }

    // Look up the environment record (created via REST registration) and enforce ownership.
    const record = await repos.environments.getById(agentId)
    if (!record || record.workerType !== 'acp' || !canAccessAgent(entry.user, record)) {
      sendToWs(entry.ws, { type: 'error', message: 'Agent not found' })
      return
    }

    await repos.environments.update(agentId, { status: 'active', lastPollAt: new Date() })

    const channelGroupId = record.bridgeId || `group_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    entry.agentId = record.id
    entry.channelGroupId = channelGroupId
    entry.capabilities = record.capabilities || null
    bindChannelGroup(entry)

    console.log(`[ACP-WS] Agent identified (REST+WS): agentId=${record.id} channelGroup=${channelGroupId}`)
    sendToWs(entry.ws, {
      type: 'identified',
      agent_id: record.id,
      channel_group_id: channelGroupId,
    })
  } finally {
    // Release the in-flight flag on failure so a transient DB error can be retried.
    if (!entry.agentId) entry.binding = false
  }
}

/** Called from onMessage — processes NDJSON lines. */
export function handleAcpWsMessage(repos: Repositories, ws: WSContext, wsId: string, data: string): void {
  const entry = connections.get(wsId)
  if (!entry) return

  entry.lastClientActivity = Date.now()

  const lines = data.split('\n').filter((line) => line.trim())
  for (const line of lines) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('[ACP-WS] parse error:', line)
      continue
    }

    // Handle keepalive.
    if (msg.type === 'keep_alive') {
      if (entry.agentId) {
        repos.environments.update(entry.agentId, { lastPollAt: new Date() }).catch(() => {})
      }
      continue
    }

    // Handle registration (legacy WS-only).
    if (msg.type === 'register') {
      handleRegister(repos, entry, msg).catch((err) => console.error('[ACP-WS] register failed:', err))
      continue
    }

    // Handle identify (REST registration + WS binding).
    if (msg.type === 'identify') {
      handleIdentify(repos, entry, msg).catch((err) => console.error('[ACP-WS] identify failed:', err))
      continue
    }

    // Not registered yet — reject.
    if (!entry.agentId) {
      sendToWs(entry.ws, {
        type: 'error',
        message: 'Not registered. Send register message first.',
      })
      continue
    }

    repos.environments.update(entry.agentId, { lastPollAt: new Date() }).catch(() => {})

    // Pass-through: publish to channel group EventBus as inbound.
    const bus = getAcpEventBus(entry.channelGroupId)
    bus.publish({
      id: randomUUID(),
      sessionId: entry.channelGroupId,
      type: (msg.type as string) || 'acp_message',
      payload: msg,
      direction: 'inbound',
    })
  }
}

/** Called from onClose — marks agent offline and cleans up. */
export function handleAcpWsClose(
  repos: Repositories,
  ws: WSContext,
  wsId: string,
  code?: number,
  reason?: string,
): void {
  void ws
  const entry = connections.get(wsId)
  if (!entry) return

  const duration = Math.round((Date.now() - entry.openTime) / 1000)
  console.log(
    `[ACP-WS] Connection closed: wsId=${wsId} agentId=${entry.agentId} code=${code ?? 'none'} reason=${reason || '(none)'} duration=${duration}s`,
  )

  if (entry.unsub) entry.unsub()
  if (entry.keepalive) clearInterval(entry.keepalive)

  // Mark agent as offline (don't delete record — allow reconnect).
  if (entry.agentId) {
    markAgentOffline(repos, entry.agentId).catch(() => {})

    // Notify all relay connections that this agent is gone.
    if (entry.channelGroupId) {
      const bus = getAcpEventBus(entry.channelGroupId)
      bus.publish({
        id: randomUUID(),
        sessionId: entry.channelGroupId,
        type: 'agent_disconnect',
        payload: { agentId: entry.agentId },
        direction: 'inbound',
      })
    }
  }

  connections.delete(wsId)
}

async function markAgentOffline(repos: Repositories, agentId: string): Promise<void> {
  const record = await repos.environments.getById(agentId)
  if (!record || record.workerType !== 'acp') return
  await repos.environments.update(agentId, { status: 'offline' })
}

/** Find an active ACP connection by agent ID. */
export function findAcpConnectionByAgentId(agentId: string): AcpConnectionEntry | null {
  for (const entry of connections.values()) {
    if (entry.agentId === agentId && entry.ws.readyState === 1) {
      return entry
    }
  }
  return null
}

/** Send a JSON message directly to an agent's WebSocket connection. */
export function sendToAgentWs(agentId: string, msg: object): boolean {
  const entry = findAcpConnectionByAgentId(agentId)
  if (!entry) return false
  sendToWs(entry.ws, msg)
  return true
}

/**
 * Gracefully close all ACP WebSocket connections.
 *
 * Sockets and keepalive intervals are torn down synchronously; the offline
 * writes are awaited so they complete before the caller releases the database
 * pool (otherwise they race the pool close and silently fail).
 */
export async function closeAllAcpConnections(repos: Repositories): Promise<void> {
  if (connections.size === 0) return

  console.log(`[ACP-WS] Gracefully closing ${connections.size} ACP connection(s)...`)
  const offlineWrites: Promise<void>[] = []
  for (const entry of connections.values()) {
    try {
      if (entry.unsub) entry.unsub()
      if (entry.keepalive) clearInterval(entry.keepalive)
      if (entry.ws.readyState === 1) {
        entry.ws.close(1001, 'server_shutdown')
      }
      if (entry.agentId) {
        offlineWrites.push(markAgentOffline(repos, entry.agentId).catch(() => {}))
      }
    } catch {
      // ignore errors during shutdown
    }
  }
  connections.clear()
  await Promise.all(offlineWrites)
  console.log('[ACP-WS] All connections closed')
}
