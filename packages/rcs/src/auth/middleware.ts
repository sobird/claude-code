/**
 * Gateway authentication and authorization middlewares.
 *
 * Every middleware reads repositories from `c.get('repos')`, which `createGateway` sets
 * once for all routes. Credentials arrive via `Authorization: Bearer …` or the
 * `rcs.auth.*` WebSocket subprotocol (see `context.ts`); URLs never carry tokens.
 *
 * Verified credential classes:
 * - Access-token JWT (browser UI) — no database call, valid until expiry (~5 min).
 * - User API key — hashed lookup, rejected when revoked or when the owner is disabled.
 * - Legacy `RCS_API_KEYS` — constant-time match, mapped to the first bootstrap admin.
 * - Environment token — scoped to one environment id.
 * - Worker token — scoped to one session id (`cse_*`).
 */

import { timingSafeEqual } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'

import { toCompatibleCodeSessionId } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'

import { hashApiKey } from './api-key.js'
import type { AppContext, AppEnv, AuthUser } from './context.js'
import { extractWebSocketAuthToken } from './context.js'
import { verifyAccessToken, verifyEnvironmentToken, verifyWorkerToken } from './tokens.js'

export interface AuthOptions {
  /** Legacy `RCS_API_KEYS`; matched in constant time and mapped to the first admin. */
  legacyKeys?: string[]
}

function unauthorized(c: AppContext, message: string): Response {
  return c.json({ error: message }, 401)
}

function forbidden(c: AppContext, message: string): Response {
  return c.json({ error: message }, 403)
}

/** Length-aware constant-time comparison; differing lengths are never equal. */
function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** The first enabled admin by creation order (repositories list ascending by `createdAt`). */
async function findBootstrapAdmin(repos: Repositories): Promise<AuthUser | null> {
  const users = await repos.users.list()
  const admin = users.find((user) => user.role === 'admin' && user.disabledAt === null)
  if (!admin) return null
  return { id: admin.id, username: admin.username, role: admin.role }
}

/**
 * Resolves a user API key or a legacy key to its owning user. Returns `null` when the
 * key is unknown, revoked, owned by a missing/disabled user, or legacy with no admin.
 * Successful user-key lookups record `lastUsedAt`.
 */
async function resolveApiKeyUser(repos: Repositories, token: string, legacyKeys: string[]): Promise<AuthUser | null> {
  const record = await repos.apiKeys.getByHash(hashApiKey(token))
  if (record) {
    if (record.revokedAt) return null
    const user = await repos.users.getById(record.userId)
    if (!user || user.disabledAt) return null
    await repos.apiKeys.touch(record.id)
    return { id: user.id, username: user.username, role: user.role }
  }

  for (const legacy of legacyKeys) {
    if (timingSafeEqualString(token, legacy)) {
      return findBootstrapAdmin(repos)
    }
  }
  return null
}

function setAccessTokenUser(c: AppContext, claims: AuthUser): void {
  c.set('user', claims)
}

/** Accepts only short-lived access-token JWTs and sets `c.user`. */
export const accessTokenAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractWebSocketAuthToken(c)
  if (!token) return unauthorized(c, 'missing access token')
  const claims = await verifyAccessToken(token)
  if (!claims) return unauthorized(c, 'invalid access token')
  setAccessTokenUser(c, { id: claims.sub, username: claims.username, role: claims.role })
  return next()
}

/** Accepts only user API keys (plus any configured legacy keys) and sets `c.user`. */
export function createApiKeyAuth(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const legacyKeys = options.legacyKeys ?? []
  return async (c, next) => {
    const token = extractWebSocketAuthToken(c)
    if (!token) return unauthorized(c, 'missing API key')
    const user = await resolveApiKeyUser(c.get('repos'), token, legacyKeys)
    if (!user) return unauthorized(c, 'invalid API key')
    c.set('user', user)
    return next()
  }
}

/** API-key-only middleware with no legacy keys configured. */
export const apiKeyAuth = createApiKeyAuth()

/**
 * General user authentication chain: access token first (no DB), then user API key, then
 * legacy key. Use this for `/web/*` and other user-facing routes.
 */
export function createUserAuth(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const legacyKeys = options.legacyKeys ?? []
  return async (c, next) => {
    const token = extractWebSocketAuthToken(c)
    if (!token) return unauthorized(c, 'missing credentials')

    const claims = await verifyAccessToken(token)
    if (claims) {
      setAccessTokenUser(c, { id: claims.sub, username: claims.username, role: claims.role })
      return next()
    }

    const user = await resolveApiKeyUser(c.get('repos'), token, legacyKeys)
    if (!user) return unauthorized(c, 'invalid credentials')
    c.set('user', user)
    return next()
  }
}

/** General user auth with no legacy keys configured. */
export const userAuth = createUserAuth()

/** Requires a previously authenticated admin. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user) return unauthorized(c, 'authentication required')
  if (user.role !== 'admin') return forbidden(c, 'admin access required')
  return next()
}

/**
 * Guards environment-scoped routes (`:id` is the environment id). Accepts an environment
 * token bound to `:id`, or an API key whose user owns the environment or is an admin.
 * Loads the record and sets `c.environment`.
 */
export function createEnvironmentAuth(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const legacyKeys = options.legacyKeys ?? []
  return async (c, next) => {
    const repos = c.get('repos')
    const routeId = c.req.param('id')
    if (!routeId) return unauthorized(c, 'missing environment id')

    const environment = await repos.environments.getById(routeId)
    if (!environment) return c.json({ error: 'environment not found' }, 404)

    const token = extractWebSocketAuthToken(c)
    if (!token) return unauthorized(c, 'missing credentials')

    const environmentToken = await verifyEnvironmentToken(token)
    if (environmentToken) {
      if (environmentToken.environmentId !== routeId) {
        return forbidden(c, 'environment token does not match route')
      }
      c.set('environment', environment)
      return next()
    }

    const user = await resolveApiKeyUser(repos, token, legacyKeys)
    if (!user) return unauthorized(c, 'invalid credentials')
    if (user.role !== 'admin' && environment.ownerUserId !== user.id) {
      return forbidden(c, 'not the environment owner')
    }
    c.set('user', user)
    c.set('environment', environment)
    return next()
  }
}

/** Environment guard with no legacy keys configured. */
export const environmentAuth = createEnvironmentAuth()

/** Why a session-ingress credential was rejected. */
export type SessionIngressAuthFailureReason = 'unauthorized' | 'forbidden' | 'not_found'

/**
 * Discriminated result of resolving a session-ingress credential. `user` is set only when
 * an API key (or legacy key) authenticated the caller; worker and environment tokens carry
 * no user.
 */
export type SessionIngressAuthResult =
  | { ok: true; workerSessionId: string; user: AuthUser | null }
  | { ok: false; reason: SessionIngressAuthFailureReason; message: string }

/**
 * Resolves a session-ingress credential (`:id` is a `cse_*` or web `session_*` session id).
 *
 * Shared by the HTTP middleware (which maps failures to 401/403/404 JSON) and the
 * WebSocket route (which completes the upgrade and closes with 4003/4001 so the CLI
 * transport sees a real close code instead of a failed upgrade). Accepts a worker token
 * bound to the session, an environment token whose user owns the session's environment, or
 * an API key whose user owns the session / is an admin / the session is unowned.
 */
export async function resolveSessionIngressAuth(
  repos: Repositories,
  routeId: string | undefined,
  token: string | null,
  legacyKeys: string[] = [],
): Promise<SessionIngressAuthResult> {
  if (!routeId) return { ok: false, reason: 'unauthorized', message: 'missing session id' }

  const canonicalId = toCompatibleCodeSessionId(routeId) ?? routeId
  const session = await repos.sessions.getById(canonicalId)
  if (!session) return { ok: false, reason: 'not_found', message: 'session not found' }

  if (!token) return { ok: false, reason: 'unauthorized', message: 'missing credentials' }

  const user = await resolveApiKeyUser(repos, token, legacyKeys)
  if (user) {
    if (user.role !== 'admin' && session.ownerUserId !== null && session.ownerUserId !== user.id) {
      return { ok: false, reason: 'forbidden', message: 'not the session owner' }
    }
    return { ok: true, workerSessionId: canonicalId, user }
  }

  const workerToken = await verifyWorkerToken(token)
  if (workerToken) {
    if (workerToken.sessionId !== routeId && workerToken.sessionId !== canonicalId) {
      return { ok: false, reason: 'forbidden', message: 'worker token does not match session' }
    }
    return { ok: true, workerSessionId: canonicalId, user: null }
  }

  const environmentToken = await verifyEnvironmentToken(token)
  if (environmentToken) {
    const environment = session.environmentId ? await repos.environments.getById(session.environmentId) : null
    if (!environment || environment.ownerUserId !== environmentToken.userId) {
      return { ok: false, reason: 'forbidden', message: 'environment token does not own the session environment' }
    }
    return { ok: true, workerSessionId: canonicalId, user: null }
  }

  return { ok: false, reason: 'unauthorized', message: 'invalid credentials' }
}

/**
 * Guards session-ingress routes (`:id` is a `cse_*` or web `session_*` session id).
 * Sets `c.workerSessionId` to the canonical `cse_*` id (and `c.user` for API keys).
 */
export function createSessionIngressAuth(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  const legacyKeys = options.legacyKeys ?? []
  return async (c, next) => {
    const result = await resolveSessionIngressAuth(
      c.get('repos'),
      c.req.param('id'),
      extractWebSocketAuthToken(c),
      legacyKeys,
    )

    if (!result.ok) {
      if (result.reason === 'not_found') return c.json({ error: result.message }, 404)
      if (result.reason === 'forbidden') return forbidden(c, result.message)
      return unauthorized(c, result.message)
    }

    if (result.user) c.set('user', result.user)
    c.set('workerSessionId', result.workerSessionId)
    return next()
  }
}

/** Session-ingress guard with no legacy keys configured. */
export const sessionIngressAuth = createSessionIngressAuth()
