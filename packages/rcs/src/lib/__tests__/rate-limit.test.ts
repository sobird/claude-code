import { expect, test } from 'bun:test'

import { createRateLimiter } from '../rate-limit.js'

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

test('window resets after it elapses', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 20 })
  expect(limiter.check('key')).toBe(true)
  expect(limiter.check('key')).toBe(true)
  expect(limiter.check('key')).toBe(false)

  const start = Date.now()
  while (Date.now() - start < 30) {
    // Busy-wait past the window; the limiter reads Date.now() per check.
  }

  expect(limiter.check('key')).toBe(true)
})
