/**
 * Route-level helpers shared by the gateway HTTP modules.
 *
 * Middlewares are constructed per request so that legacy `RCS_API_KEYS` values are read
 * from the environment at call time (tests configure them right before exercising the
 * app, after module evaluation). No credential is ever read from a query string.
 */

import type { MiddlewareHandler } from 'hono'

import { extractWebSocketAuthToken, type AppContext, type AppEnv } from '@/auth/context'
import { createEnvironmentAuth, createSessionIngressAuth, createUserAuth } from '@/auth/middleware'
import { verifyWorkerToken } from '@/auth/tokens'
import type { EnvironmentRecord } from '@/contracts'

/** Reads legacy `RCS_API_KEYS` (comma separated) on every call. */
export function readLegacyKeys(): string[] {
  return (process.env.RCS_API_KEYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

/** Access token or user API key (plus legacy keys); sets `c.user`. */
export const legacyUserAuth: MiddlewareHandler<AppEnv> = (c, next) =>
  createUserAuth({ legacyKeys: readLegacyKeys() })(c, next)

/** Environment token or API key owning `:id`; sets `c.environment`. */
export const legacyEnvironmentAuth: MiddlewareHandler<AppEnv> = (c, next) =>
  createEnvironmentAuth({ legacyKeys: readLegacyKeys() })(c, next)

/** Worker token, environment token, or owning API key for session `:id`. */
export const legacySessionIngressAuth: MiddlewareHandler<AppEnv> = (c, next) =>
  createSessionIngressAuth({ legacyKeys: readLegacyKeys() })(c, next)

/**
 * Worker heartbeats present the worker token embedded in the work secret, while legacy
 * callers continue to use their API key. Try the worker token first, then fall back to
 * the environment guard.
 */
export const workerOrEnvironmentAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractWebSocketAuthToken(c)
  if (token) {
    const worker = await verifyWorkerToken(token)
    if (worker) {
      c.set('workerSessionId', worker.sessionId)
      return next()
    }
  }
  return legacyEnvironmentAuth(c, next)
}

/**
 * Nested gateway error shape. `code` is optional and only emitted by Web callers;
 * 既有 v1/v2/ACP 错误必须保持字节不变，因此那里继续省略 `code`。`details` 只用于
 * 新增的错误（例如 409 `session_active` 携带活动清单），同样不影响既有响应。
 */
export function jsonError(
  c: AppContext,
  type: string,
  message: string,
  status: 400 | 403 | 404 | 409 | 413 | 415 | 502 | 504,
  code?: string,
  details?: Record<string, unknown>,
) {
  const error: Record<string, unknown> = { type, message }
  if (code !== undefined) error.code = code
  if (details !== undefined) error.details = details
  return c.json({ error }, status)
}

export function notFound(c: AppContext, message = 'Session not found') {
  return jsonError(c, 'not_found', message, 404)
}

export function forbidden(c: AppContext, message = 'Not your session') {
  return jsonError(c, 'forbidden', message, 403)
}

/** Web-only `notFound` with a stable code the browser can translate. */
export function webNotFound(c: AppContext, message = 'Session not found', code = 'session_not_found') {
  return jsonError(c, 'not_found', message, 404, code)
}

/** Web-only `forbidden` with a stable code the browser can translate. */
export function webForbidden(c: AppContext, message = 'Not your session', code = 'forbidden') {
  return jsonError(c, 'forbidden', message, 403, code)
}

export function sessionClosed(c: AppContext, status: string) {
  return jsonError(c, 'session_closed', `Session is ${status}`, 409, 'session_closed')
}

export interface DispatchEnvironmentAccess {
  /** The environment row, or `null` when the id is unknown. */
  environment: EnvironmentRecord | null
  /** True when the caller neither owns the environment nor is an admin. */
  forbiddenForCaller: boolean
}

/**
 * Resolves the target environment for work dispatch and enforces ownership. Members may
 * only dispatch onto their own environments; unowned legacy environments remain usable by
 * any authenticated caller. Admins bypass the ownership check.
 */
export async function resolveDispatchEnvironment(
  c: AppContext,
  environmentId: string,
): Promise<DispatchEnvironmentAccess> {
  const environment = await c.get('repos').environments.getById(environmentId)
  if (!environment) return { environment: null, forbiddenForCaller: false }
  const user = c.get('user')
  const forbiddenForCaller =
    environment.ownerUserId !== null && environment.ownerUserId !== user.id && user.role !== 'admin'
  return { environment, forbiddenForCaller }
}

/** Parses a JSON body without throwing on empty/invalid input. */
export async function readJson(c: AppContext): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
