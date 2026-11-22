import { describe, expect, test } from 'bun:test'

import { DEFAULT_LOCALE, isLocale, negotiateLocale, nextLocaleCookie, resolveLocale } from '@/i18n/locales'

describe('isLocale', () => {
  test('accepts only exact supported tags', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zh')).toBe(false)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })
})

describe('negotiateLocale', () => {
  test('maps language variants onto supported locales', () => {
    expect(negotiateLocale('zh-TW')).toBe('zh-CN')
    expect(negotiateLocale('zh-Hant-HK')).toBe('zh-CN')
    expect(negotiateLocale('en-GB')).toBe('en')
  })

  test('honors q-weights', () => {
    expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en')
    expect(negotiateLocale('zh-CN;q=0.4,en-US;q=0.9')).toBe('en')
  })

  test('ignores wildcards, unsupported ranges, and zero quality', () => {
    expect(negotiateLocale('*')).toBeNull()
    expect(negotiateLocale('fr-FR')).toBeNull()
    expect(negotiateLocale('en;q=0')).toBeNull()
    expect(negotiateLocale(null)).toBeNull()
    expect(negotiateLocale('')).toBeNull()
  })
})

describe('resolveLocale', () => {
  test('prefers a supported cookie', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'zh-CN' })).toBe('en')
  })

  test('falls through an unsupported cookie to Accept-Language', () => {
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'zh-TW' })).toBe('zh-CN')
  })

  test('prefers the device cookie over the session claim', () => {
    expect(resolveLocale({ cookie: 'en', session: 'zh-CN' })).toBe('en')
  })

  test('uses the session claim before Accept-Language', () => {
    expect(resolveLocale({ session: 'en', acceptLanguage: 'zh-CN' })).toBe('en')
    expect(resolveLocale({ session: 'fr', acceptLanguage: 'zh-TW' })).toBe('zh-CN')
  })

  test('defaults to zh-CN', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE)
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })
})

describe('nextLocaleCookie', () => {
  test('returns only supported stored values', () => {
    expect(nextLocaleCookie('en')).toBe('en')
    expect(nextLocaleCookie('fr')).toBeNull()
    expect(nextLocaleCookie(null)).toBeNull()
    expect(nextLocaleCookie(undefined)).toBeNull()
  })
})
