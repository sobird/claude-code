/**
 * Short-lived access-token minting endpoint.
 *
 * Exchanges the caller's Auth.js session (cookie) for a 300-second HS256 JWT
 * the browser sends to the gateway as `Authorization: Bearer …`. Minting is
 * rate limited per `(ip, username)`; anonymous requests get `401`, over-limit
 * requests get `429`.
 */

import { NextResponse } from 'next/server'

import { ACCESS_TOKEN_TTL_SECONDS, createAccessTokenForSession } from '../../../lib/access-token'
import { auth } from '../../../lib/auth'
import { getClientIp } from '../../../lib/client-ip'
import { createRateLimiter } from '../../../lib/rate-limit'

export const runtime = 'nodejs'

/** Five token exchanges per minute per `(ip, username)`. */
const tokenLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 })

async function mintAccessToken(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const username = session.user.name ?? ''
  const ip = getClientIp(request.headers)
  if (!tokenLimiter.check(`${ip}:${username}`)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  try {
    const token = await createAccessTokenForSession(session)
    return NextResponse.json({ token, expiresIn: ACCESS_TOKEN_TTL_SECONDS })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
}

export { mintAccessToken as GET, mintAccessToken as POST }
