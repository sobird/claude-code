/**
 * Shared Hono context types and credential extraction for the gateway.
 *
 * Runtime-neutral: this module only uses `hono` core types and Node's `Buffer`, so it is
 * safe to import from Next tests as well as the Bun gateway. Credentials are never read
 * from the URL: HTTP callers use `Authorization: Bearer …`, WebSocket callers use either
 * the same header or the `rcs.auth.<base64url(token)>` subprotocol.
 */

import { Buffer } from 'node:buffer'

import type { Context } from 'hono'

import type { EnvironmentRecord, Role } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'

/** The authenticated principal attached to requests by the auth middlewares. */
export interface AuthUser {
  id: string
  username: string
  role: Role
}

/** Variables every gateway route can rely on once `createGateway` injects `repos`. */
export interface AppEnv {
  Variables: {
    repos: Repositories
    user: AuthUser
    environment: EnvironmentRecord
    workerSessionId: string
  }
}

export type AppContext = Context<AppEnv>

const BEARER_PREFIX = 'bearer '
const WS_AUTH_PREFIX = 'rcs.auth.'

/** Reads `Authorization: Bearer <token>` (case-insensitive scheme); never the query string. */
export function extractBearerToken(c: AppContext): string | null {
  const header = c.req.header('authorization')
  if (!header) return null
  const value = header.trim()
  if (value.length <= BEARER_PREFIX.length) return null
  if (value.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) return null
  const token = value.slice(BEARER_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

/** Encodes a token as the `rcs.auth.<base64url(token)>` WebSocket subprotocol. */
export function encodeWebSocketAuthProtocol(token: string): string {
  return `${WS_AUTH_PREFIX}${Buffer.from(token, 'utf8').toString('base64url')}`
}

function decodeProtocolToken(value: string): string | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

/**
 * Resolves a token for both HTTP and WebSocket upgrades: the `Authorization` header when
 * present, otherwise the first `rcs.auth.*` entry of `Sec-WebSocket-Protocol`.
 */
export function extractWebSocketAuthToken(c: AppContext): string | null {
  const bearer = extractBearerToken(c)
  if (bearer) return bearer

  const header = c.req.header('sec-websocket-protocol')
  if (!header) return null
  for (const entry of header.split(',')) {
    const protocol = entry.trim()
    if (!protocol.startsWith(WS_AUTH_PREFIX)) continue
    const token = decodeProtocolToken(protocol.slice(WS_AUTH_PREFIX.length))
    if (token) return token
  }
  return null
}
