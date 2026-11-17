/**
 * Locale preference endpoint.
 *
 * Accepts `{ locale }` from the authenticated user, persists it on the user
 * row, and mirrors it into the `rcs_locale` cookie so subsequent renders pick
 * the new language without waiting for the session to refresh.
 */

import { NextResponse } from 'next/server'

import { LOCALE_COOKIE, localeCookieOptions } from '../../../i18n/locales'
import { auth } from '../../../lib/auth'
import { setUserLocale } from '../../../lib/preferences'
import { getRepositories } from '../../../lib/repos'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  const body: unknown = await request.json().catch(() => null)
  const result = await setUserLocale(getRepositories(), session.user.id, body)
  if (!result.ok) {
    return NextResponse.json({ error: 'invalid locale', code: result.code }, { status: 400 })
  }

  const response = NextResponse.json({ locale: result.locale })
  response.cookies.set(LOCALE_COOKIE, result.locale, localeCookieOptions())
  return response
}
