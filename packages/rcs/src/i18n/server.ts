// src/i18n/server.ts
import { cookies, headers } from 'next/headers'

import { LOCALE_COOKIE, resolveLocale, type Locale } from './locales'

export async function resolveRequestLocale(): Promise<Locale> {
  const [jar, incoming] = await Promise.all([cookies(), headers()])
  return resolveLocale({
    cookie: jar.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: incoming.get('accept-language'),
  })
}
