import { describe, expect, test } from 'bun:test'

import { loadConfig } from '../../config.js'
import { buildNotificationPayload, isConfirmationRequest, shouldNotifyOnce } from '../push-payload.js'

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

describe('loadConfig VAPID fields', () => {
  test('reads the pair and defaults the subject', () => {
    const config = loadConfig({
      RCS_AUTH_SECRET: 'x',
      RCS_VAPID_PUBLIC_KEY: 'pub',
      RCS_VAPID_PRIVATE_KEY: 'priv',
    } as unknown as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBe('pub')
    expect(config.vapidPrivateKey).toBe('priv')
    expect(config.vapidSubject).toBe('mailto:noreply@localhost')
  })

  test('treats missing or empty values as null', () => {
    const config = loadConfig({ RCS_AUTH_SECRET: 'x', RCS_VAPID_PUBLIC_KEY: '  ' } as unknown as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBeNull()
    expect(config.vapidPrivateKey).toBeNull()
  })
})
