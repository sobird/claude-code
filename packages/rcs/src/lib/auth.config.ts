/**
 * Shared, Edge-safe Auth.js configuration.
 *
 * Holds everything the middleware needs (secret, trustHost, JWT sessions,
 * pages, claim mapping) without any database or Node-only imports. The full
 * instance in `auth.ts` spreads this config and adds the Credentials provider.
 */

import type { NextAuthConfig } from 'next-auth'

import type { Role } from '../contracts'

/** Next `basePath`; every route below is prefixed with it. */
export const APP_BASE_PATH = '/code'

/** Where unauthenticated users are sent (browser-facing, includes `basePath`). */
export const LOGIN_PATH = `${APP_BASE_PATH}/login`

/** Login route as seen by middleware/route handlers (`basePath` stripped). */
export const LOGIN_ROUTE = '/login'

/**
 * Auth.js API base path.
 *
 * The Browser-facing endpoint is `/code/api/auth/*` (route handler
 * `app/api/auth/[...nextauth]` plus Next's `basePath: '/code'`). However,
 * Next strips the app `basePath` from the URL handed to route handlers, so
 * Auth.js itself parses `/api/auth/*`. Using `/code/api/auth` here makes every
 * request to `/code/api/auth/*` fail with `400 Bad request` (UnknownAction).
 * Server-action `signIn`/`signOut` build URLs from this value and call Auth
 * directly, so they stay consistent.
 */
export const AUTH_BASE_PATH = '/api/auth'

/** Extra claims persisted in the encrypted Auth.js session JWT. */
interface SessionClaims {
  id?: string
  username?: string
  role?: Role
}

export const authConfig = {
  basePath: AUTH_BASE_PATH,
  secret: process.env.RCS_AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: LOGIN_PATH },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const claims = user as SessionClaims & { name?: string | null }
        token.id = claims.id
        token.username = claims.name ?? undefined
        token.role = claims.role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        const claims = token as SessionClaims & { sub?: string }
        const target = session.user as { id?: string; name?: string | null; role?: Role }
        target.id = claims.id ?? claims.sub
        if (claims.username) target.name = claims.username
        target.role = claims.role
      }
      return session
    },
  },
} satisfies NextAuthConfig
