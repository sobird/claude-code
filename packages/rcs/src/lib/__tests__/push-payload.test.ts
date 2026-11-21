import { describe, expect, test } from 'bun:test'

import { loadConfig } from '@/config'
import {
  buildNotificationPayload,
  isAllowedPushEndpoint,
  isConfirmationRequest,
  shouldNotifyOnce,
} from '@/lib/push-payload'

const nested = {
  request_id: 'req-1',
  request: { subtype: 'can_use_tool', tool_name: 'Bash', description: 'Run tests', input: { command: 'bun test' } },
}

describe('isConfirmationRequest', () => {
  test('accepts a nested can_use_tool control request', () => {
    expect(isConfirmationRequest('control_request', nested)).toBe(true)
  })

  test('accepts the flat shape', () => {
    expect(isConfirmationRequest('control_request', { ...nested.request, request_id: 'req-1' })).toBe(true)
  })

  test('rejects other subtypes, event types, and junk', () => {
    expect(isConfirmationRequest('control_request', { request: { subtype: 'set_model' } })).toBe(false)
    expect(isConfirmationRequest('permission_response', nested)).toBe(false)
    expect(isConfirmationRequest('control_request', null)).toBe(false)
  })
})

describe('buildNotificationPayload', () => {
  test('maps permission requests', () => {
    expect(buildNotificationPayload({ id: 's1', title: 'Fix tests' }, 'control_request', nested)).toEqual({
      v: 1,
      kind: 'permission',
      sessionId: 's1',
      sessionTitle: 'Fix tests',
      toolName: 'Bash',
      description: 'Run tests',
      requestId: 'req-1',
    })
  })

  test('emits the web-facing session id so the worker can match visible paths', () => {
    const payload = buildNotificationPayload({ id: 'cse_abc', title: null }, 'control_request', nested)
    expect(payload?.sessionId).toBe('session_abc')
  })

  test('maps AskUserQuestion and ExitPlanMode kinds', () => {
    const kindOf = (tool: string) =>
      buildNotificationPayload({ id: 's1', title: null }, 'control_request', {
        request_id: 'r',
        request: { subtype: 'can_use_tool', tool_name: tool },
      })?.kind
    expect(kindOf('AskUserQuestion')).toBe('question')
    expect(kindOf('ExitPlanMode')).toBe('plan')
    expect(kindOf('Edit')).toBe('permission')
  })

  test('returns null without a request id or when not a confirmation', () => {
    expect(
      buildNotificationPayload({ id: 's1', title: null }, 'control_request', { request: { subtype: 'can_use_tool' } }),
    ).toBeNull()
    expect(buildNotificationPayload({ id: 's1', title: null }, 'user', nested)).toBeNull()
  })
})

describe('shouldNotifyOnce', () => {
  test('suppresses repeats inside the window and allows them after it', () => {
    const seen = new Map<string, number>()
    expect(shouldNotifyOnce(seen, 's1:req-1', 1_000)).toBe(true)
    expect(shouldNotifyOnce(seen, 's1:req-1', 2_000)).toBe(false)
    expect(shouldNotifyOnce(seen, 's1:req-1', 70_000)).toBe(true)
  })
})

describe('isAllowedPushEndpoint', () => {
  test('accepts a standard HTTPS push endpoint', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://push.example/abc')).toBe(true)
    // An explicit :443 is the browser default and equivalent to no port.
    expect(isAllowedPushEndpoint('https://push.example:443/abc')).toBe(true)
  })

  test('rejects non-HTTPS, garbage, and non-URL values', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false)
    expect(isAllowedPushEndpoint('not a url')).toBe(false)
    expect(isAllowedPushEndpoint('')).toBe(false)
  })

  test('rejects localhost and .local/.localhost names', () => {
    expect(isAllowedPushEndpoint('https://localhost/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://something.localhost/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://printer.local/x')).toBe(false)
  })

  test('rejects a non-default port', () => {
    expect(isAllowedPushEndpoint('https://push.example:8443/x')).toBe(false)
  })

  test('rejects loopback, private, link-local, and unspecified IPv4 literals', () => {
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://10.0.0.5/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://172.16.0.1/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://172.31.255.255/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://192.168.1.1/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://169.254.169.254/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://0.0.0.0/x')).toBe(false)
  })

  test('rejects loopback, unspecified, unique-local, and link-local IPv6 literals', () => {
    expect(isAllowedPushEndpoint('https://[::1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[fc00::1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[fd12:3456::1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[fe80::1]/x')).toBe(false)
  })

  test('rejects IPv4-mapped IPv6 literals for disallowed IPv4 ranges', () => {
    expect(isAllowedPushEndpoint('https://[::ffff:127.0.0.1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::ffff:169.254.169.254]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::ffff:10.0.0.1]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::ffff:c0a8:101]/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://[::ffff:7f00:1]/x')).toBe(false)
  })
})

describe('loadConfig VAPID fields', () => {
  test('reads the pair and defaults the subject', () => {
    const config = loadConfig({
      RCS_AUTH_SECRET: 'x',
      RCS_VAPID_PUBLIC_KEY: 'pub',
      RCS_VAPID_PRIVATE_KEY: 'priv',
    } as unknown as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBe('pub')
    expect(config.vapidPrivateKey).toBe('priv')
    expect(config.vapidSubject).toBe('mailto:noreply@example.com')
  })

  test('treats missing or empty values as null', () => {
    const config = loadConfig({ RCS_AUTH_SECRET: 'x', RCS_VAPID_PUBLIC_KEY: '  ' } as unknown as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBeNull()
    expect(config.vapidPrivateKey).toBeNull()
  })
})
