/**
 * Signed JWT helpers shared by the gateway and Next.
 *
 * All tokens are HS256 JWTs issued by `rcs` with a kind-specific audience. The signing
 * secret is read lazily from `RCS_AUTH_SECRET` on every call so tests can configure it
 * after import. Sign functions throw when the secret is missing; verify functions never
 * throw and return `null` for any invalid token.
 */

import { jwtVerify, SignJWT, type JWTPayload } from 'jose'

import type { Role } from '../contracts.js'

const ISSUER = 'rcs'

const ACCESS_AUDIENCE = 'rcs-api'
const ENVIRONMENT_AUDIENCE = 'rcs-environment'
const WORKER_AUDIENCE = 'rcs-worker'

const DEFAULT_ACCESS_TTL_SECONDS = 3600
const DEFAULT_ENVIRONMENT_TTL_SECONDS = 2592000
const DEFAULT_WORKER_TTL_SECONDS = 3600

function readSecret(): Uint8Array | null {
  const secret = process.env.RCS_AUTH_SECRET?.trim()
  if (!secret) return null
  return new TextEncoder().encode(secret)
}

function requireSecret(): Uint8Array {
  const secret = readSecret()
  if (!secret) throw new Error('RCS_AUTH_SECRET is required to sign tokens')
  return secret
}

function expiration(ttlSeconds: number): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds
}

async function verifyWithAudience(token: string, audience: string): Promise<JWTPayload | null> {
  const secret = readSecret()
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience,
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}

export async function signAccessToken(
  user: { id: string; username: string; role: Role },
  ttlSeconds: number = DEFAULT_ACCESS_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiration(ttlSeconds))
    .sign(requireSecret())
}

export async function verifyAccessToken(token: string): Promise<{ sub: string; username: string; role: Role } | null> {
  const payload = await verifyWithAudience(token, ACCESS_AUDIENCE)
  if (!payload) return null
  const { sub, username, role } = payload
  if (typeof sub !== 'string' || typeof username !== 'string') return null
  if (role !== 'admin' && role !== 'member') return null
  return { sub, username, role }
}

export async function signEnvironmentToken(
  environmentId: string,
  userId: string,
  ttlSeconds: number = DEFAULT_ENVIRONMENT_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ env_id: environmentId, user_id: userId, role: 'environment' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(ENVIRONMENT_AUDIENCE)
    .setSubject(environmentId)
    .setIssuedAt()
    .setExpirationTime(expiration(ttlSeconds))
    .sign(requireSecret())
}

export async function verifyEnvironmentToken(token: string): Promise<{ environmentId: string; userId: string } | null> {
  const payload = await verifyWithAudience(token, ENVIRONMENT_AUDIENCE)
  if (!payload) return null
  const { env_id: environmentId, user_id: userId, role } = payload
  if (typeof environmentId !== 'string' || typeof userId !== 'string') return null
  if (role !== 'environment') return null
  return { environmentId, userId }
}

export async function signWorkerToken(
  sessionId: string,
  ttlSeconds: number = DEFAULT_WORKER_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ session_id: sessionId, role: 'worker' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(WORKER_AUDIENCE)
    .setSubject(sessionId)
    .setIssuedAt()
    .setExpirationTime(expiration(ttlSeconds))
    .sign(requireSecret())
}

export async function verifyWorkerToken(token: string): Promise<{ sessionId: string } | null> {
  const payload = await verifyWithAudience(token, WORKER_AUDIENCE)
  if (!payload) return null
  const { session_id: sessionId, role } = payload
  if (typeof sessionId !== 'string') return null
  if (role !== 'worker') return null
  return { sessionId }
}
