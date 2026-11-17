import { describe, expect, test } from 'bun:test'

import { buildSdkUrl } from '../workSecret.js'

describe('buildSdkUrl', () => {
  test('uses wss for an https base URL, even on localhost', () => {
    expect(buildSdkUrl('https://localhost:4000', 'cse_abc')).toBe('wss://localhost:4000/v2/session_ingress/ws/cse_abc')
    expect(buildSdkUrl('https://rcs.example.com', 'cse_abc')).toBe(
      'wss://rcs.example.com/v1/session_ingress/ws/cse_abc',
    )
  })

  test('uses ws for an http base URL', () => {
    expect(buildSdkUrl('http://localhost:4000', 'cse_abc')).toBe('ws://localhost:4000/v2/session_ingress/ws/cse_abc')
    expect(buildSdkUrl('http://rcs.example.com', 'cse_abc')).toBe('ws://rcs.example.com/v1/session_ingress/ws/cse_abc')
  })

  test('keeps the localhost /v2 split and strips trailing slashes', () => {
    expect(buildSdkUrl('http://127.0.0.1:4000/', 'cse_abc')).toBe('ws://127.0.0.1:4000/v2/session_ingress/ws/cse_abc')
  })
})
