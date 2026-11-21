import { describe, expect, test } from 'bun:test'

import { getClientIp } from '@/lib/client-ip'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('getClientIp', () => {
  test('uses the right-most x-forwarded-for hop (the proxy-added peer)', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 10.0.0.2' }))).toBe('10.0.0.2')
  })

  test('ignores a client-supplied left-most entry', () => {
    const spoofed = headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' })
    expect(getClientIp(spoofed)).toBe('198.51.100.7')
    expect(getClientIp(spoofed)).not.toBe('1.2.3.4')
  })

  test('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(headers({ 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5')
  })

  test('returns unknown when no forwarding header is present', () => {
    expect(getClientIp(new Headers())).toBe('unknown')
  })

  test('skips an empty x-forwarded-for entry and falls back to x-real-ip', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': ' , ', 'x-real-ip': '192.0.2.6' }))).toBe('192.0.2.6')
  })
})
