/**
 * Route protection middleware (Edge runtime).
 *
 * Uses only the DB-free shared Auth.js config. Unauthenticated page requests
 * are redirected to `/login?next=<path>`; authenticated users visiting the
 * login page are sent to the dashboard root. API routes, Auth.js endpoints, and
 * Next internals are excluded from the matcher so route handlers enforce their
 * own auth (e.g. `/api/access-token` returns JSON 401s).
 */

import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig, LOGIN_PATH } from './lib/auth.config'

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
  // Exclude the gateway's path prefixes: the UI and the gateway share one URL
  // space, and in dev Next rewrites proxy these paths to the gateway. Middleware
  // runs before rewrites, so without this an unauthenticated `/web/...` call
  // would be redirected to `/login` instead of reaching the gateway.
  //
  // Also exclude Auth.js endpoints, Next internals, and static assets; API
  // routes enforce auth themselves.
  //
  // PWA assets must stay publicly reachable: browsers fetch the web app manifest
  // with credentials mode `omit`, so an auth redirect would turn it into HTML and
  // the app could never be installed. The service worker route and its chunks,
  // icons, and the offline page are likewise loaded outside an authenticated page
  // context, so they are excluded from the guard as well.
  matcher: [
    '/',
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|serwist/|~offline|(?:v1|v2|acp|web)(?:/|$)|health$).*)',
  ],
}
