/**
 * Route protection middleware (Edge runtime).
 *
 * Uses only the DB-free shared Auth.js config. Unauthenticated page requests
 * are redirected to `/code/login?next=<path>`; authenticated users visiting the
 * login page are sent to the dashboard root. API routes, Auth.js endpoints, and
 * Next internals are excluded from the matcher so route handlers enforce their
 * own auth (e.g. `/code/api/access-token` returns JSON 401s).
 */

import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { APP_BASE_PATH, authConfig, LOGIN_PATH, LOGIN_ROUTE } from './lib/auth.config'

const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const { nextUrl } = request
  // Next strips the app `basePath`, so this is e.g. `/login`, not `/code/login`.
  const pathname = nextUrl.pathname
  const isLoggedIn = Boolean(request.auth?.user)

  if (pathname === LOGIN_ROUTE || pathname === `${LOGIN_ROUTE}/`) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL(APP_BASE_PATH, nextUrl))
    }
    return NextResponse.next()
  }

  if (!isLoggedIn) {
    const loginUrl = new URL(LOGIN_PATH, nextUrl)
    const target = pathname === '/' ? APP_BASE_PATH : `${APP_BASE_PATH}${pathname}`
    loginUrl.searchParams.set('next', `${target}${nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Next strips `basePath` before matching middleware, so patterns are relative
  // to `/code`. Exclude Auth.js endpoints, Next internals, and static assets;
  // API routes enforce auth themselves.
  matcher: ['/', '/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
