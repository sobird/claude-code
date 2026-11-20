import { expect, test } from 'bun:test'

import { defaultApiKeyName, defaultSessionTitle, requestLocale } from '../default-titles'
import { DEFAULT_LOCALE } from '../locales'

test('requestLocale negotiates from Accept-Language', () => {
  expect(requestLocale('en-GB')).toBe('en')
  expect(requestLocale('zh-TW')).toBe('zh-CN')
  expect(requestLocale('fr')).toBe(DEFAULT_LOCALE)
  expect(requestLocale(null)).toBe(DEFAULT_LOCALE)
})

test('web defaults follow the negotiated locale', () => {
  expect(defaultSessionTitle('en')).toBe('New Session')
  expect(defaultSessionTitle('zh-CN')).toBe('新会话')
  expect(defaultApiKeyName('en')).toBe('API key')
  expect(defaultApiKeyName('zh-CN')).toBe('API 密钥')
})
