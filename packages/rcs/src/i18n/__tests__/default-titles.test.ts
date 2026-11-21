import { expect, test } from 'bun:test'

import { defaultApiKeyName, defaultSessionTitle } from '@/i18n/default-titles'

test('web defaults follow the negotiated locale', () => {
  expect(defaultSessionTitle('en')).toBe('New Session')
  expect(defaultSessionTitle('zh-CN')).toBe('新会话')
  expect(defaultApiKeyName('en')).toBe('API key')
  expect(defaultApiKeyName('zh-CN')).toBe('API 密钥')
})
