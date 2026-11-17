// src/i18n/default-titles.ts
import { CATALOGS } from './catalogs.js'
import { DEFAULT_LOCALE, negotiateLocale } from './locales.js'
import type { Locale } from './locales.js'

/** Locale for a web request; unsupported or missing headers fall back to the default. */
export function requestLocale(acceptLanguage: string | null | undefined): Locale {
  return negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE
}

export function defaultSessionTitle(locale: Locale): string {
  return CATALOGS[locale].common.defaultSessionTitle
}

export function defaultApiKeyName(locale: Locale): string {
  return CATALOGS[locale].common.defaultApiKeyName
}
