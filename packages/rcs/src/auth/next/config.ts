/**
 * Shared, Edge-safe Auth.js configuration.
 *
 * Holds everything the middleware needs (secret, trustHost, JWT sessions,
 * pages, claim mapping) without any database or Node-only imports. The full
 * instance in `auth/next/index.ts` spreads this config and adds the Credentials
 * provider.
 */

import type { NextAuthConfig } from 'next-auth'

import type { Role } from '@/contracts'
import type { Locale } from '@/i18n/locales'

/** Where unauthenticated users are sent. */
export const LOGIN_PATH = '/login'

/**
 * Auth.js API base path, matching the route handler at
 * `app/api/auth/[...nextauth]`. Server-action `signIn`/`signOut` build URLs
 * from this value and call Auth directly, so they stay consistent with it.
 */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * Extra claims persisted in the encrypted Auth.js session JWT. The `jwt` and
 * `session` callbacks receive opaque Auth.js types (`User | AdapterUser`, a
 * `Record<string, unknown>` token), so this view is the single documented
 * boundary where those claims are read and written.
 */
interface SessionClaims {
  id?: string
  username?: string
  role?: Role
  locale?: Locale | null
}

/** The subset of `session.user` we populate from the claims. */
interface SessionUserView {
  id?: string
  name?: string | null
  role?: Role
  locale?: Locale | null
}

export const authConfig = {
  basePath: AUTH_BASE_PATH,
  secret: process.env.RCS_AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: LOGIN_PATH },
  providers: [],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        const claims = user as SessionClaims & { name?: string | null }
        token.id = claims.id
        token.username = claims.name ?? undefined
        token.role = claims.role
        token.locale = claims.locale ?? null
      }
      // `unstable_update({ user: { locale } })` lands here after a preference
      // change so the current device's JWT carries the new locale without a
      // re-login.
      if (trigger === 'update') {
        const update = session as { user?: SessionUserView } | null
        if (update?.user?.locale !== undefined) token.locale = update.user.locale
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        const claims = token as SessionClaims & { sub?: string }
        const target = session.user as SessionUserView
        target.id = claims.id ?? claims.sub
        if (claims.username) target.name = claims.username
        target.role = claims.role
        target.locale = claims.locale ?? null
      }
      return session
    },
  },
} satisfies NextAuthConfig
