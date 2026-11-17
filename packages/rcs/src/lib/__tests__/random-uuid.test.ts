import { afterEach, describe, expect, test } from 'bun:test'

import { randomUuid } from '../random-uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const originalRandomUuid = crypto.randomUUID

afterEach(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: originalRandomUuid,
    configurable: true,
    writable: true,
  })
})

describe('randomUuid', () => {
  test('returns a v4 uuid', () => {
    expect(randomUuid()).toMatch(UUID_V4)
  })

  test('falls back to getRandomValues when randomUUID is unavailable', () => {
    // Insecure origins (LAN over plain HTTP) do not expose crypto.randomUUID.
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true, writable: true })
    expect(randomUuid()).toMatch(UUID_V4)
  })

  test('generates unique values', () => {
    expect(new Set(Array.from({ length: 200 }, () => randomUuid())).size).toBe(200)
  })
})
