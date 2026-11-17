/**
 * Short-lived access-token minting endpoint.
 *
 * Exchanges the caller's Auth.js session (cookie) for a 300-second HS256 JWT
 * the browser sends to the gateway as `Authorization: Bearer …`. Minting is
 * rate limited per `(ip, username)`; anonymous requests, missing users, and
 * disabled users get `401`, over-limit requests get `429`. Only `POST` is
 * exposed (the spec is `POST /code/api/access-token`).
 */

import { NextResponse } from 'next/server'

import { ACCESS_TOKEN_TTL_SECONDS, mintAccessTokenForSession } from '../../../lib/access-token'
import { auth } from '../../../lib/auth'
import { getClientIp } from '../../../lib/client-ip'
import { createRateLimiter } from '../../../lib/rate-limit'
import { getRepositories } from '../../../lib/repos'

export const runtime = 'nodejs'

/** Five token exchanges per minute per `(ip, username)`. */
const tokenLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 })

async function mintAccessToken(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  const username = session.user.name ?? ''
  const ip = getClientIp(request.headers)
  if (!tokenLimiter.check(`${ip}:${username}`)) {
    return NextResponse.json({ error: 'rate limited', code: 'rate_limited' }, { status: 429 })
  }

  try {
    // Missing and disabled users both yield `null`; answer the same 401 either way.
    const token = await mintAccessTokenForSession(session, getRepositories())
    if (token === null) {
      return NextResponse.json({ error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ token, expiresIn: ACCESS_TOKEN_TTL_SECONDS })
  } catch {
    return NextResponse.json({ error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }
}

export { mintAccessToken as POST }
