// src/i18n/server.ts
import { cookies, headers } from 'next/headers'
import { cache } from 'react'

import { auth } from '@/lib/auth'

import { LOCALE_COOKIE, resolveLocale, type Locale } from './locales'

/**
 * Resolve the request locale. Precedence: explicit cookie (this device) →
 * session JWT locale claim (synced across devices on sign-in) → Accept-Language
 * → default.
 */
export const resolveRequestLocale = cache(async (): Promise<Locale> => {
  const [jar, incoming, session] = await Promise.all([cookies(), headers(), auth()])
  return resolveLocale({
    cookie: jar.get(LOCALE_COOKIE)?.value ?? null,
    session: session?.user?.locale ?? null,
    acceptLanguage: incoming.get('accept-language'),
  })
})
