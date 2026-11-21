import { describe, expect, test } from 'bun:test'

import {
  MAX_TITLE_LENGTH,
  parseNotificationPayload,
  shouldShowNotification,
  toNotificationContent,
} from '@/lib/notification-content'
import type { PushNotificationPayload } from '@/lib/push-payload'

const payload: PushNotificationPayload = {
  v: 1,
  kind: 'permission',
  sessionId: 's1',
  sessionTitle: 'Fix tests',
  toolName: 'Bash',
  requestId: 'req-1',
}

describe('parseNotificationPayload', () => {
  test('accepts a valid payload', () => {
    expect(parseNotificationPayload(payload)).toEqual(payload)
  })

  test('rejects missing identifiers and unknown kinds', () => {
    expect(parseNotificationPayload({ ...payload, sessionId: undefined })).toBeNull()
    expect(parseNotificationPayload({ ...payload, requestId: undefined })).toBeNull()
    expect(parseNotificationPayload({ ...payload, kind: 'other' })).toBeNull()
    expect(parseNotificationPayload({ ...payload, v: 2 })).toBeNull()
    expect(parseNotificationPayload(null)).toBeNull()
    expect(parseNotificationPayload('nope')).toBeNull()
  })
})

describe('toNotificationContent', () => {
  test('uses the session title and interpolates the tool name', () => {
    expect(toNotificationContent(payload, 'en')).toEqual({
      title: 'Fix tests',
      body: 'Permission needed: Bash',
      tag: 'session:s1:req-1',
      url: '/s1',
    })
  })

  test('falls back to the localized title without a session title', () => {
    const { sessionTitle: _omit, ...bare } = payload
    expect(toNotificationContent(bare, 'en').title).toBe('Claude needs your confirmation')
    expect(toNotificationContent(bare, 'zh-CN').title).toBe('Claude 需要你确认')
  })

  test('truncates a long session title to MAX_TITLE_LENGTH plus an ellipsis', () => {
    const long = { ...payload, sessionTitle: 'x'.repeat(200) }
    const title = toNotificationContent(long, 'en').title
    expect(title.length).toBe(MAX_TITLE_LENGTH + 1)
    expect(title).toBe(`${'x'.repeat(MAX_TITLE_LENGTH)}…`)
  })

  test('trims surrounding whitespace before truncating', () => {
    const padded = { ...payload, sessionTitle: `  ${'x'.repeat(200)}  ` }
    const title = toNotificationContent(padded, 'en').title
    expect(title).toBe(`${'x'.repeat(MAX_TITLE_LENGTH)}…`)
  })

  test('truncation never splits a surrogate pair', () => {
    // Each 🔔 is one code point but two UTF-16 units; the ellipsis must land on
    // a code-point boundary rather than emitting a lone surrogate.
    const emoji = { ...payload, sessionTitle: '🔔'.repeat(MAX_TITLE_LENGTH + 10) }
    const title = toNotificationContent(emoji, 'en').title
    expect(Array.from(title)).toHaveLength(MAX_TITLE_LENGTH + 1)
    expect(title).toBe(`${'🔔'.repeat(MAX_TITLE_LENGTH)}…`)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })

  test('question and plan bodies differ from permission and leak no placeholder', () => {
    const bodyFor = (kind: PushNotificationPayload['kind']) =>
      toNotificationContent({ ...payload, kind, toolName: 'SomeTool' }, 'en').body
    const permission = bodyFor('permission')
    const question = bodyFor('question')
    const plan = bodyFor('plan')
    expect(question).not.toBe(permission)
    expect(plan).not.toBe(permission)
    expect(question).not.toContain('{tool}')
    expect(plan).not.toContain('{tool}')
  })
})

describe('shouldShowNotification', () => {
  test('suppresses only when a visible client is on the session path', () => {
    expect(shouldShowNotification(['/s1'], 's1')).toBe(false)
    expect(shouldShowNotification(['/s2'], 's1')).toBe(true)
    expect(shouldShowNotification([], 's1')).toBe(true)
  })
})
