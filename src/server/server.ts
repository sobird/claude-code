/**
 * HTTP + WebSocket front door for `claude server` (direct-connect).
 *
 * Clients `POST /sessions` to create a session, then open the returned
 * `ws_url` to drive it. The server owns the backend child process (via the
 * injected `SessionManager`) and bridges its NDJSON stdio over the socket:
 *
 *   client --(JSON frame, no newline)--> websocket --> child stdin (+ "\n")
 *   child stdout --(line)--> websocket --> client (newline-delimited)
 *
 * REST surface (all requiring `Authorization: Bearer <authToken>`):
 *   POST   /sessions              create a session, return {session_id, ws_url, work_dir}
 *   GET    /sessions              list live sessions
 *   GET    /sessions/:id          fetch one session
 *   DELETE /sessions/:id          destroy a session
 *   GET    /sessions/:id/ws       websocket upgrade to bridge a session
 *   GET    / | /health            liveness probe
 *
 * Lines emitted by a child before any client is attached are buffered and
 * replayed on connect, so a freshly spawned session's `system init` frame is
 * never lost between `POST /sessions` and the websocket handshake.
 */

import type { ServerWebSocket } from 'bun'

import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { ServerLogger } from './serverLog.js'
import { type ManagedSession, type SessionManager, SessionLimitError } from './sessionManager.js'
import type { ServerConfig } from './types.js'

/** Upper bound on lines buffered per session before the first client attaches. */
const MAX_BACKLOG_LINES = 1000

interface WsData {
  sessionId: string
}

interface SessionBridge {
  /** Lines emitted while no client is attached, replayed on the next connect. */
  buffer: string[]
  sockets: Set<ServerWebSocket<WsData>>
  off: () => void
}

export interface ServerHandle {
  port: number | undefined
  stop(closeActiveConnections: boolean): void
}

const noopLogger: ServerLogger = { info() {}, warn() {}, error() {}, debug() {} }

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(jsonStringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function unauthorized(): Response {
  return jsonResponse({ error: 'unauthorized' }, 401)
}

/** Send a single NDJSON line to a socket, tolerating a socket that just closed. */
function sendLine(ws: ServerWebSocket<WsData>, line: string): void {
  try {
    ws.send(`${line}\n`)
  } catch {
    // Socket already closing/closed — the close handler removes it from the set.
  }
}

/**
 * Start the HTTP/WebSocket server and return a handle whose `stop` closes it.
 * `port` reflects the bound port (useful when the caller passed port 0).
 */
export function startServer(
  config: ServerConfig,
  sessionManager: SessionManager,
  logger: ServerLogger = noopLogger,
): ServerHandle {
  const bridges = new Map<string, SessionBridge>()

  const createBridge = (session: ManagedSession): SessionBridge => {
    const bridge: SessionBridge = { buffer: [], sockets: new Set(), off: () => {} }
    bridge.off = session.addLineListener((line) => {
      if (bridge.sockets.size === 0) {
        bridge.buffer.push(line)
        if (bridge.buffer.length > MAX_BACKLOG_LINES) bridge.buffer.shift()
        return
      }
      for (const ws of bridge.sockets) sendLine(ws, line)
    })
    session.addExitListener(() => {
      bridge.off()
      bridges.delete(session.id)
      // Snapshot: closing a socket deletes it from the set via the close handler.
      for (const ws of Array.from(bridge.sockets)) {
        try {
          ws.close()
        } catch {
          // already closed
        }
      }
      bridge.sockets.clear()
    })
    return bridge
  }

  const server = Bun.serve<WsData>({
    ...(config.unix ? { unix: config.unix } : { port: config.port, hostname: config.host }),
    async fetch(req, srv) {
      if (req.headers.get('authorization') !== `Bearer ${config.authToken}`) {
        return unauthorized()
      }

      const { pathname } = new URL(req.url)

      // --- websocket upgrade: bridge the child's stdio ---
      const wsMatch = pathname.match(/^\/sessions\/([^/]+)\/ws$/)
      if (wsMatch) {
        if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
          return jsonResponse({ error: 'expected websocket upgrade' }, 400)
        }
        const id = decodeURIComponent(wsMatch[1])
        if (!sessionManager.getSession(id)) {
          return jsonResponse({ error: 'session not found' }, 404)
        }
        const upgraded = srv.upgrade(req, { data: { sessionId: id } })
        return upgraded ? undefined : jsonResponse({ error: 'upgrade failed' }, 400)
      }

      // --- create a session ---
      if (pathname === '/sessions' && req.method === 'POST') {
        let body: { cwd?: unknown; dangerously_skip_permissions?: unknown } = {}
        try {
          const parsed = await req.json()
          if (typeof parsed === 'object' && parsed !== null) {
            body = parsed as typeof body
          }
        } catch {
          // An empty body is valid: cwd falls back to the workspace default.
        }

        let session: ManagedSession
        try {
          session = sessionManager.createSession({
            cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
            dangerouslySkipPermissions: body.dangerously_skip_permissions === true,
          })
        } catch (error) {
          if (error instanceof SessionLimitError) {
            return jsonResponse({ error: error.message }, 429)
          }
          logger.error(`failed to create session: ${errorMessage(error)}`)
          return jsonResponse({ error: 'failed to create session' }, 500)
        }

        bridges.set(session.id, createBridge(session))
        const host = req.headers.get('host') ?? `${config.host}:${srv.port}`
        return jsonResponse({
          session_id: session.id,
          ws_url: `ws://${host}/sessions/${session.id}/ws`,
          work_dir: session.workDir,
        })
      }

      // --- list sessions ---
      if (pathname === '/sessions' && req.method === 'GET') {
        return jsonResponse({ sessions: sessionManager.listSessions() })
      }

      // --- single session ---
      const idMatch = pathname.match(/^\/sessions\/([^/]+)$/)
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1])
        if (req.method === 'GET') {
          const info = sessionManager.listSessions().find((s) => s.id === id)
          return info ? jsonResponse({ session: info }) : jsonResponse({ error: 'session not found' }, 404)
        }
        if (req.method === 'DELETE') {
          await sessionManager.destroySession(id)
          const bridge = bridges.get(id)
          if (bridge) {
            bridge.off()
            bridges.delete(id)
          }
          return new Response(null, { status: 204 })
        }
      }

      // --- liveness ---
      if (pathname === '/' || pathname === '/health') {
        return jsonResponse({ status: 'ok' })
      }

      return jsonResponse({ error: 'not found' }, 404)
    },
    websocket: {
      open(ws) {
        const id = ws.data.sessionId
        const session = sessionManager.getSession(id)
        const bridge = bridges.get(id)
        if (!session || !bridge) {
          ws.close()
          return
        }
        session.attach()
        // Replay anything emitted before this client attached, then go live.
        for (const line of bridge.buffer.splice(0)) sendLine(ws, line)
        bridge.sockets.add(ws)
      },
      message(ws, message) {
        const session = sessionManager.getSession(ws.data.sessionId)
        if (!session) return
        const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
        // The client sends one JSON frame with no trailing newline; the child
        // expects NDJSON, so normalise every line to end with "\n".
        for (const raw of text.split('\n')) {
          const line = raw.trim()
          if (line) session.writeStdin(`${line}\n`)
        }
      },
      close(ws) {
        bridges.get(ws.data.sessionId)?.sockets.delete(ws)
        sessionManager.getSession(ws.data.sessionId)?.detach()
      },
    },
  })

  return {
    port: server.port,
    stop(closeActiveConnections: boolean) {
      // Bun returns a promise from stop(); the caller is synchronous, so ignore it.
      void server.stop(closeActiveConnections)
    },
  }
}
