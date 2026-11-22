export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'zh-CN'

export const LOCALE_COOKIE = 'rcs_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const LANGUAGE_TAG_PATTERN = /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/i

interface LanguageEntry {
  tag: string
  q: number
}

export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value)
}

function parseQuality(params: string[]): number | null {
  let q = 1
  for (const param of params) {
    const [key = '', value = ''] = param.split('=')
    if (key.trim().toLowerCase() !== 'q') continue
    q = Number(value.trim())
    if (!Number.isFinite(q) || q < 0 || q > 1) return null
  }
  return q
}

function parseAcceptLanguage(acceptLanguage: string | null | undefined): LanguageEntry[] {
  if (!acceptLanguage) return []
  const entries: LanguageEntry[] = []
  for (const part of acceptLanguage.split(',')) {
    const [rawTag = '', ...params] = part.split(';')
    const tag = rawTag.trim()
    if (tag !== '*' && !LANGUAGE_TAG_PATTERN.test(tag)) continue
    const q = parseQuality(params)
    if (q === null || q <= 0) continue
    entries.push({ tag, q })
  }
  // Array.prototype.toSorted is stable, so equal q-weights keep header order.
  return entries.toSorted((a, b) => b.q - a.q)
}

function matchLocale(tag: string): Locale | null {
  const lower = tag.toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return null
}

export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const locale = matchLocale(tag)
    if (locale) return locale
  }
  return null
}

export function nextLocaleCookie(stored: string | null | undefined): Locale | null {
  return isLocale(stored) ? stored : null
}

export function resolveLocale(input: {
  cookie?: string | null
  /** Locale claim from the session JWT; lets devices converge across sign-ins. */
  session?: string | null
  acceptLanguage?: string | null
}): Locale {
  const cookieLocale = nextLocaleCookie(input.cookie)
  const sessionLocale = isLocale(input.session) ? input.session : null
  return cookieLocale ?? sessionLocale ?? negotiateLocale(input.acceptLanguage) ?? DEFAULT_LOCALE
}

export function localeCookieOptions(): {
  path: '/'
  maxAge: number
  sameSite: 'lax'
  httpOnly: true
  secure: boolean
} {
  return {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  }
}
