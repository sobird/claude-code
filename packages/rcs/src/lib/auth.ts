/**
 * Full Auth.js instance for the Next server (Node runtime).
 *
 * Extends the Edge-safe shared config with a Credentials provider backed by the
 * Postgres user repository. Usernames are normalized to lowercase, disabled
 * users are rejected, and login attempts are rate limited per `(ip, username)`.
 * The bootstrap-admin promise is awaited (best effort) before the first lookup
 * because instrumentation hooks are not guaranteed to run under `next start`.
 */

import NextAuth from 'next-auth'
import type { User } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { verifyPassword } from '../auth/password'
import type { Role } from '../contracts'
import { authConfig } from './auth.config'
import { ensureBootstrapAdminOnce } from './bootstrap-runner'
import { getClientIp } from './client-ip'
import { createRateLimiter } from './rate-limit'
import { getRepositories } from './repos'

/** Five login attempts per minute per `(ip, username)`. */
export const LOGIN_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const

const loginLimiter = createRateLimiter(LOGIN_RATE_LIMIT)

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const username = typeof credentials.username === 'string' ? credentials.username.trim().toLowerCase() : ''
        const password = typeof credentials.password === 'string' ? credentials.password : ''
        if (!username || !password) return null

        const ip = getClientIp(request.headers)
        if (!loginLimiter.check(`${ip}:${username}`)) return null

        try {
          // Best effort: never let bootstrap failures block login.
          await ensureBootstrapAdminOnce()

          const repos = getRepositories()
          const user = await repos.users.getByUsername(username)
          if (!user || user.disabledAt) return null
          if (!(await verifyPassword(password, user.passwordHash))) return null

          const authenticated: User & { role: Role } = {
            id: user.id,
            name: user.username,
            role: user.role,
          }
          return authenticated
        } catch (error) {
          console.error('[rcs] login failed:', error)
          return null
        }
      },
    }),
  ],
})
