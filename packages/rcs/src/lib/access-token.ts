/**
 * Access-token minting for browser sessions.
 *
 * Auth.js sessions live in the Next server; the gateway (separate process)
 * cannot read them. Instead the browser exchanges its Auth.js session for a
 * short-lived HS256 JWT signed with the shared `RCS_AUTH_SECRET`. The gateway
 * verifies those tokens via `verifyAccessToken` from `src/auth/tokens.ts`.
 *
 * This module is intentionally free of Next-only imports so it can be unit
 * tested under `bun test` (pure jose + the shared token helper).
 */

import { signAccessToken } from '../auth/tokens'
import type { Role } from '../contracts'
import type { Repositories } from '../db/repositories/types'

/** Access tokens are valid for five minutes. */
export const ACCESS_TOKEN_TTL_SECONDS = 300

/**
 * Minimal session shape needed to mint a token. Accepts both the real Auth.js
 * `Session` and plain objects in tests. `name` is the normalized username.
 */
export interface SessionLike {
  user?: {
    id?: string | null
    name?: string | null
    role?: Role | null
  } | null
}

/**
 * Mints a 300-second access token for the session user.
 *
 * Rejects sessions without a user id (Auth.js requires one for JWT sessions)
 * and sessions whose role is not a known role. Throws on those cases so callers
 * can map them to a `401` rather than issuing a token for an anonymous user.
 */
export async function createAccessTokenForSession(session: SessionLike | null): Promise<string> {
  const user = session?.user
  const id = user?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('session user id is required')
  }
  const name = user?.name
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('session user name is required')
  }
  const role = user?.role
  if (role !== 'admin' && role !== 'member') {
    throw new Error('session user role is required')
  }

  return signAccessToken({ id, username: name, role }, ACCESS_TOKEN_TTL_SECONDS)
}

/**
 * Mints an access token only when the session user currently exists and is not
 * disabled. Returns `null` for both cases so callers can answer `401` without
 * revealing whether the id exists.
 *
 * The username and role come from the freshly loaded user row, so role changes
 * and account removal take effect without waiting for the session to expire.
 */
export async function mintAccessTokenForSession(
  session: SessionLike | null,
  repos: Repositories,
): Promise<string | null> {
  const id = session?.user?.id
  if (typeof id !== 'string' || id.length === 0) return null

  const user = await repos.users.getById(id)
  if (!user || user.disabledAt !== null) return null

  return signAccessToken({ id: user.id, username: user.username, role: user.role }, ACCESS_TOKEN_TTL_SECONDS)
}
