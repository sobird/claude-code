/**
 * Bun gateway entrypoint.
 *
 * Connects Postgres, applies migrations, mounts the gateway, starts the disconnect
 * monitor, and exports the Bun server config (Bun auto-serves a default-export config).
 * Next.js owns the UI on port 3000; this process only serves `/v1`, `/v2`, `/web`, `/acp`
 * and `/health`. `scripts/dev.ts` spawns it via `bun --watch server/index.ts`.
 */

import { loadConfig } from '../src/config.js'
import { closeDatabase, createPostgresDatabase, runMigrations } from '../src/db/client.js'
import { createRepositories } from '../src/db/repositories/index.js'
import { createGateway } from '../src/gateway.js'
import { log } from '../src/logger.js'
import { startDisconnectMonitor, stopDisconnectMonitor } from '../src/services/disconnect-monitor.js'
import { initPushNotifier } from '../src/services/push-notifier.js'
import { closeAllRelayConnections } from '../src/transport/acp-relay-handler.js'
import { closeAllAcpConnections } from '../src/transport/acp-ws-handler.js'
import { closeAllConnections } from '../src/transport/ws-handler.js'
import { websocket } from '../src/transport/ws-shared.js'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('[RCS] DATABASE_URL is required (e.g. postgres://user:pass@localhost:5432/rcs)')
}

const config = loadConfig()
const db = createPostgresDatabase(databaseUrl)

log('[RCS] Applying database migrations...')
await runMigrations(db)

const repos = createRepositories(db)
const app = createGateway({ config, repos })

log('[RCS] ACP support enabled')
log(`[RCS] Remote Control Server starting on ${config.host}:${config.port}`)
log('[RCS] API key configuration loaded')
log(`[RCS] Base URL: ${config.baseUrl || `http://localhost:${config.port}`}`)
log(`[RCS] Disconnect timeout: ${config.disconnectTimeout}s`)
log(`[RCS] WebSocket idle timeout: ${config.wsIdleTimeout}s (protocol-level pings)`)
log(`[RCS] WebSocket keepalive interval: ${config.wsKeepaliveInterval}s (data frames)`)

startDisconnectMonitor({ repos, config })

await initPushNotifier({ config, repos })

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    idleTimeout: config.wsIdleTimeout, // Bun sends protocol pings after this many seconds of silence
  },
  idleTimeout: config.wsIdleTimeout, // HTTP server idle timeout (seconds)
}

let shuttingDown = false

/** Stop the monitor, close live sockets, release the pool, then exit. */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log(`\n[RCS] Received ${signal}, shutting down...`)
  stopDisconnectMonitor()
  closeAllConnections()
  await closeAllAcpConnections(repos)
  closeAllRelayConnections()
  await closeDatabase(db)
  process.exit(0)
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM')
})
