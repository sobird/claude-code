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
}

const DEFAULT_PORT = 4000
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_POLL_TIMEOUT = 8
const DEFAULT_HEARTBEAT_INTERVAL = 20
const DEFAULT_JWT_EXPIRES_IN = 3600
const DEFAULT_ENV_TOKEN_TTL = 2592000
const DEFAULT_DISCONNECT_TIMEOUT = 300
const DEFAULT_WS_IDLE_TIMEOUT = 30
const DEFAULT_WS_KEEPALIVE_INTERVAL = 20
const DEFAULT_EVENT_REPLAY_LIMIT = 5000

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : fallback
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

  return {
    version: pkg.version,
    port,
    host: env.RCS_HOST?.trim() || DEFAULT_HOST,
    authSecret,
    baseUrl,
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
  }
}
