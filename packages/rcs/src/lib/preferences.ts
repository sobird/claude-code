/**
 * Locale preference parsing and persistence.
 *
 * The `users.locale` column has no DB-level constraint, so request bodies are
 * validated here (at the API boundary) before reaching the repository.
 */

import type { Repositories } from '../db/repositories/types'
import { isLocale, type Locale } from '../i18n/locales'

export type SetUserLocaleResult = { ok: true; locale: Locale } | { ok: false; code: 'invalid_locale' }

/** Returns the supported locale carried by a plain object body, or `null`. */
export function parseLocalePreference(body: unknown): Locale | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const locale = (body as { locale?: unknown }).locale
  return isLocale(locale) ? locale : null
}

/** Persists a valid locale preference; invalid input never reaches the repository. */
export async function setUserLocale(repos: Repositories, userId: string, body: unknown): Promise<SetUserLocaleResult> {
  const locale = parseLocalePreference(body)
  if (!locale) return { ok: false, code: 'invalid_locale' }
  await repos.users.update(userId, { locale })
  return { ok: true, locale }
}
