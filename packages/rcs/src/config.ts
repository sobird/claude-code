/**
 * Gateway environment configuration.
 *
 * Next owns port 3000; the gateway listens on 4000 by default. `loadConfig` accepts an
 * explicit env object so tests never depend on the ambient process environment.
 */

import pkg from '../package.json'

export interface GatewayConfig {
  version: string
  port: number
  host: string
  authSecret: string
  baseUrl: string
  /** UI origin used to render pairing links; defaults to `baseUrl`. */
  webUrl: string
  apiKeys: string[]
  pollTimeout: number
  heartbeatInterval: number
  jwtExpiresIn: number
  envTokenTtl: number
  disconnectTimeout: number
  wsIdleTimeout: number
  wsKeepaliveInterval: number
  eventReplayLimit: number
  webCorsOrigins: string[]
  vapidPublicKey: string | null
  vapidPrivateKey: string | null
  vapidSubject: string
}

const DEFAULT_PORT = 4000
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_POLL_TIMEOUT = 8
const DEFAULT_HEARTBEAT_INTERVAL = 20
const DEFAULT_JWT_EXPIRES_IN = 3600
const DEFAULT_ENV_TOKEN_TTL = 2592000
// The CLI bridge polls every 600s once its sessions are at capacity, so a 300s threshold
// reaped a live worker between polls and made its environment flicker. Keep the default
// comfortably above the at-capacity poll interval.
const DEFAULT_DISCONNECT_TIMEOUT = 1200
const DEFAULT_WS_IDLE_TIMEOUT = 30
const DEFAULT_WS_KEEPALIVE_INTERVAL = 20
const DEFAULT_EVENT_REPLAY_LIMIT = 5000
// Apple's push service rejects a VAPID subject whose domain has no public TLD
// (`mailto:noreply@localhost` → 403 BadJwtToken), so default to a valid address.
const DEFAULT_VAPID_SUBJECT = 'mailto:noreply@example.com'

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : fallback
}

function readOptional(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name]?.trim()
  return raw ? raw : null
}

function readList(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const authSecret = (env.RCS_AUTH_SECRET ?? '').trim()
  if (!authSecret) {
    throw new Error('RCS_AUTH_SECRET is required')
  }

  const port = readInt(env, 'RCS_PORT', DEFAULT_PORT)
  const baseUrl = (env.RCS_BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, '')
  // 开发时 Next 在 :3000、网关在 :4000；设备码批准页属于 UI，必须指向 3000。
  const webUrl = (env.RCS_WEB_URL?.trim() || baseUrl).replace(/\/+$/, '')

  return {
    version: pkg.version,
    port,
    host: env.RCS_HOST?.trim() || DEFAULT_HOST,
    authSecret,
    baseUrl,
    webUrl,
    apiKeys: readList(env, 'RCS_API_KEYS'),
    pollTimeout: readInt(env, 'RCS_POLL_TIMEOUT', DEFAULT_POLL_TIMEOUT),
    heartbeatInterval: readInt(env, 'RCS_HEARTBEAT_INTERVAL', DEFAULT_HEARTBEAT_INTERVAL),
    jwtExpiresIn: readInt(env, 'RCS_JWT_EXPIRES_IN', DEFAULT_JWT_EXPIRES_IN),
    envTokenTtl: readInt(env, 'RCS_ENV_TOKEN_TTL', DEFAULT_ENV_TOKEN_TTL),
    disconnectTimeout: readInt(env, 'RCS_DISCONNECT_TIMEOUT', DEFAULT_DISCONNECT_TIMEOUT),
    wsIdleTimeout: readInt(env, 'RCS_WS_IDLE_TIMEOUT', DEFAULT_WS_IDLE_TIMEOUT),
    wsKeepaliveInterval: readInt(env, 'RCS_WS_KEEPALIVE_INTERVAL', DEFAULT_WS_KEEPALIVE_INTERVAL),
    eventReplayLimit: readInt(env, 'RCS_EVENT_REPLAY_LIMIT', DEFAULT_EVENT_REPLAY_LIMIT),
    webCorsOrigins: readList(env, 'RCS_WEB_CORS_ORIGINS'),
    vapidPublicKey: readOptional(env, 'RCS_VAPID_PUBLIC_KEY'),
    vapidPrivateKey: readOptional(env, 'RCS_VAPID_PRIVATE_KEY'),
    vapidSubject: env.RCS_VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT,
  }
}
