/**
 * Route protection proxy (Next.js `proxy.ts` convention, Node.js runtime).
 *
 * Uses only the DB-free shared Auth.js config. Unauthenticated page requests
 * are redirected to `/login?next=<path>`; authenticated users visiting the
 * login page are sent to the dashboard root. API routes, Auth.js endpoints, and
 * Next internals are excluded from the matcher so route handlers enforce their
 * own auth (e.g. `/api/access-token` returns JSON 401s).
 */

import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig, LOGIN_PATH } from '@/auth/next/config'

const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const { nextUrl } = request
  const pathname = nextUrl.pathname
  const isLoggedIn = Boolean(request.auth?.user)

  if (pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL('/', nextUrl))
    }
    return NextResponse.next()
  }

  if (!isLoggedIn) {
    const loginUrl = new URL(LOGIN_PATH, nextUrl)
    loginUrl.searchParams.set('next', `${pathname}${nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Exclude the gateway's path prefixes. In production Caddy routes them to the
  // gateway before Next sees them; the exclusion also keeps a direct hit on the
  // Next dev server (`:3000/web/...`) from being redirected to `/login`.
  //
  // Also exclude Auth.js endpoints, Next internals, and static assets; API
  // routes enforce auth themselves.
  //
  // PWA assets must stay publicly reachable: browsers fetch the web app manifest
  // with credentials mode `omit`, so an auth redirect would turn it into HTML and
  // the app could never be installed. The service worker route and its chunks,
  // icons, and the offline page are likewise loaded outside an authenticated page
  // context, so they are excluded from the guard as well.
  //
  // `/demo` is the mock-data design study; it stays public so the interaction
  // model can be reviewed without an account. Remove the segment when the demo
  // graduates into the real surfaces.
  matcher: [
    '/',
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|serwist/|~offline|demo(?:/|$)|(?:v1|v2|acp|web)(?:/|$)|health$).*)',
  ],
}
