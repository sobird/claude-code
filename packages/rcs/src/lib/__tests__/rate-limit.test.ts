import { expect, test } from 'bun:test'

import { createRateLimiter } from '@/lib/rate-limit'

test('rate limiter blocks the sixth attempt in a window', () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000 })
  for (let i = 0; i < 5; i++) expect(limiter.check('1.1.1.1:alice')).toBe(true)
  expect(limiter.check('1.1.1.1:alice')).toBe(false)
})

test('keys are isolated from one another', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
  expect(limiter.check('1.1.1.1:alice')).toBe(true)
  expect(limiter.check('1.1.1.1:bob')).toBe(true)
  expect(limiter.check('1.1.1.1:alice')).toBe(false)
})

test('window resets after it elapses', async () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 10 })
  expect(limiter.check('key')).toBe(true)
  expect(limiter.check('key')).toBe(true)
  expect(limiter.check('key')).toBe(false)

  await Bun.sleep(20)

  expect(limiter.check('key')).toBe(true)
})
