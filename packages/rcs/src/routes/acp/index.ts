/**
 * ACP routes (`/acp/*`).
 *
 * `/acp/ws` is API-key-only (the acp-link agent presents an API key), while the read
 * routes and the relay accept the general user chain (access token or API key) because the
 * web frontend uses access tokens. Everything is owner-scoped (R26): members only see and
 * relay to their own `acp` environments; admins see all. Channel-group membership is
 * derived from the caller's visible agents, so another member's group is a 404.
 *
 * WS authentication follows the Task 11 pattern: resolve credentials inside the
 * `upgradeWebSocket` factory, complete the upgrade, then reject via `onOpen` →
 * `ws.close(4003, 'unauthorized')` so the CLI transport sees a real close code.
 */

import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { WSContext } from 'hono/ws'

import type { AppEnv, AuthUser } from '../../auth/context.js'
import { createApiKeyAuth, createUserAuth } from '../../auth/middleware.js'
import type { EnvironmentRecord } from '../../contracts.js'
import type { Repositories } from '../../db/repositories/types.js'
import { handleRelayClose, handleRelayMessage, handleRelayOpen } from '../../transport/acp-relay-handler.js'
import { createAcpSSEStream } from '../../transport/acp-sse-writer.js'
import { handleAcpWsClose, handleAcpWsMessage, handleAcpWsOpen } from '../../transport/acp-ws-handler.js'
import { decodeWsPayload, handleSizedWsPayload } from '../../transport/ws-payload.js'
import { upgradeWebSocket, websocket } from '../../transport/ws-shared.js'
import { jsonError, legacyUserAuth, readLegacyKeys } from '../common.js'

const app = new Hono<AppEnv>()

type WsMessageEvent = { data: unknown }
type WsCloseEvent = { code?: number; reason?: string }

const WS_CLOSE_UNAUTHORIZED = 4003
const WS_CLOSE_AGENT_NOT_FOUND = 4004
const ACP_WORKER_TYPE = 'acp'

/** Response shape for an ACP agent (field names preserved from the old server). */
export function toAcpAgentResponse(env: EnvironmentRecord) {
  return {
    id: env.id,
    agent_name: env.machineName,
    channel_group_id: env.bridgeId,
    status: env.status === 'active' ? 'online' : 'offline',
    max_sessions: env.maxSessions,
    last_seen_at: env.lastPollAt ? env.lastPollAt.getTime() / 1000 : null,
    created_at: env.createdAt.getTime() / 1000,
  }
}

/** Agents visible to the caller: all for admins, own environments for members. */
async function listVisibleAgents(repos: Repositories, user: AuthUser): Promise<EnvironmentRecord[]> {
  return user.role === 'admin'
    ? repos.environments.listByWorkerType(ACP_WORKER_TYPE)
    : repos.environments.listByWorkerType(ACP_WORKER_TYPE, { ownerUserId: user.id })
}

function groupAgents(agents: EnvironmentRecord[]): Map<string, EnvironmentRecord[]> {
  const groups = new Map<string, EnvironmentRecord[]>()
  for (const agent of agents) {
    const groupId = agent.bridgeId || 'default'
    const members = groups.get(groupId)
    if (members) members.push(agent)
    else groups.set(groupId, [agent])
  }
  return groups
}

/** Runs a middleware against the current context and returns the authenticated user. */
async function resolveUserWith(
  middleware: ReturnType<typeof createUserAuth>,
  c: Context<AppEnv>,
): Promise<AuthUser | null> {
  let user: AuthUser | null = null
  await middleware(c, async () => {
    user = c.get('user')
  })
  return user
}

/** GET /acp/agents — agents visible to the caller (owner-scoped). */
app.get('/agents', legacyUserAuth, async (c) => {
  const agents = await listVisibleAgents(c.get('repos'), c.get('user'))
  return c.json(agents.map(toAcpAgentResponse))
})

/** GET /acp/channel-groups — channel groups built from the caller's visible agents. */
app.get('/channel-groups', legacyUserAuth, async (c) => {
  const agents = await listVisibleAgents(c.get('repos'), c.get('user'))
  const groups = [...groupAgents(agents).entries()].map(([id, members]) => ({
    channel_group_id: id,
    member_count: members.length,
    members: members.map(toAcpAgentResponse),
  }))
  return c.json(groups)
})

/** GET /acp/channel-groups/:id — detail; 404 when no visible member belongs to the group. */
app.get('/channel-groups/:id', legacyUserAuth, async (c) => {
  const groupId = c.req.param('id')
  const agents = await listVisibleAgents(c.get('repos'), c.get('user'))
  const members = agents.filter((agent) => (agent.bridgeId || 'default') === groupId)
  if (members.length === 0) {
    return jsonError(c, 'not_found', 'Channel group not found', 404)
  }
  return c.json({
    channel_group_id: groupId,
    member_count: members.length,
    members: members.map(toAcpAgentResponse),
  })
})

/** SSE /acp/channel-groups/:id/events — event stream for visible groups only. */
app.get('/channel-groups/:id/events', legacyUserAuth, async (c) => {
  const groupId = c.req.param('id')
  const agents = await listVisibleAgents(c.get('repos'), c.get('user'))
  const visible = agents.some((agent) => (agent.bridgeId || 'default') === groupId)
  if (!visible) {
    return jsonError(c, 'not_found', 'Channel group not found', 404)
  }

  const lastEventId = c.req.header('Last-Event-ID')
  const fromSeq = c.req.query('from_sequence_num')
  const fromSeqNum = fromSeq ? Number.parseInt(fromSeq, 10) : lastEventId ? Number.parseInt(lastEventId, 10) : 0

  return createAcpSSEStream(c, groupId, Number.isFinite(fromSeqNum) ? fromSeqNum : 0)
})

/** WS /acp/ws — acp-link agent transport (API key only). */
app.get(
  '/ws',
  upgradeWebSocket(async (c) => {
    const repos = c.get('repos')
    // API-key-only: no access tokens here (the agent is not a browser session).
    const user = await resolveUserWith(createApiKeyAuth({ legacyKeys: readLegacyKeys() }), c)

    if (!user) {
      console.log('[ACP-WS] Upgrade rejected: unauthorized')
      return {
        onOpen(_event: Event, ws: WSContext) {
          ws.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized')
        },
        onMessage() {},
        onClose() {},
        onError() {},
      }
    }

    const wsId = `acp_ws_${randomUUID().replace(/-/g, '')}`
    const authedUser = user
    console.log(`[ACP-WS] Upgrade accepted: wsId=${wsId}`)
    return {
      onOpen(_event: Event, ws: WSContext) {
        handleAcpWsOpen(repos, ws, wsId, authedUser)
      },
      onMessage(event: WsMessageEvent, ws: WSContext) {
        handleAcpWsPayload(ws, '[ACP-WS]', `wsId=${wsId}`, event.data, (data) =>
          handleAcpWsMessage(repos, ws, wsId, data),
        )
      },
      onClose(event: WsCloseEvent, ws: WSContext) {
        handleAcpWsClose(repos, ws, wsId, event.code, event.reason)
      },
      onError(_event: Event, ws: WSContext) {
        console.error(`[ACP-WS] Error on wsId=${wsId}`)
        handleAcpWsClose(repos, ws, wsId, 1006, 'websocket error')
      },
    }
  }),
)

/** WS /acp/relay/:agentId — frontend relay; user chain plus agent ownership. */
app.get(
  '/relay/:agentId',
  upgradeWebSocket(async (c) => {
    const repos = c.get('repos')
    const agentId = c.req.param('agentId')
    // The web frontend connects with an access token; API keys and legacy keys work too.
    const user = await resolveUserWith(createUserAuth({ legacyKeys: readLegacyKeys() }), c)

    if (!user) {
      console.log('[ACP-Relay] Upgrade rejected: unauthorized')
      return {
        onOpen(_event: Event, ws: WSContext) {
          ws.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized')
        },
        onMessage() {},
        onClose() {},
        onError() {},
      }
    }

    if (!agentId) {
      return {
        onOpen(_event: Event, ws: WSContext) {
          ws.close(WS_CLOSE_AGENT_NOT_FOUND, 'agent not found')
        },
        onMessage() {},
        onClose() {},
        onError() {},
      }
    }

    const relayWsId = `relay_${randomUUID().replace(/-/g, '')}`
    const authedUser = user
    console.log(`[ACP-Relay] Upgrade accepted: relayWsId=${relayWsId} agentId=${agentId}`)
    return {
      async onOpen(_event: Event, ws: WSContext) {
        await handleRelayOpen(repos, ws, relayWsId, agentId, authedUser)
      },
      onMessage(event: WsMessageEvent, ws: WSContext) {
        handleAcpWsPayload(ws, '[ACP-Relay]', `relayWsId=${relayWsId}`, event.data, (data) =>
          handleRelayMessage(ws, relayWsId, data),
        )
      },
      onClose(event: WsCloseEvent, ws: WSContext) {
        handleRelayClose(ws, relayWsId, event.code, event.reason)
      },
      onError(_event: Event, ws: WSContext) {
        console.error(`[ACP-Relay] Error on relayWsId=${relayWsId}`)
        handleRelayClose(ws, relayWsId, 1006, 'websocket error')
      },
    }
  }),
)

export const decodeAcpWsMessageData = decodeWsPayload

export function handleAcpWsPayload(
  ws: WSContext,
  logPrefix: string,
  label: string,
  payload: unknown,
  handleMessage: (data: string) => void,
): boolean {
  return handleSizedWsPayload(ws, logPrefix, label, payload, handleMessage)
}

export { websocket }
export default app
