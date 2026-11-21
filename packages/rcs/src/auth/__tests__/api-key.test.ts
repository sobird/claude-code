import { expect, test } from 'bun:test'

import { generateApiKey, hashApiKey } from '@/auth/api-key'

test('generated keys are prefixed, unique, and expose a 12-char prefix', () => {
  const a = generateApiKey()
  const b = generateApiKey()
  expect(a.raw.startsWith('rcs_')).toBe(true)
  expect(a.prefix).toBe(a.raw.slice(0, 12))
  expect(a.raw).not.toBe(b.raw)
})

test('hash is deterministic sha256 hex and never equals the raw key', () => {
  const key = generateApiKey()
  expect(key.hash).toBe(hashApiKey(key.raw))
  expect(key.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(key.hash).not.toBe(key.raw)
})
