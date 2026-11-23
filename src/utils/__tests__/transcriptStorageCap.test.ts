import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import type { AttachmentMessage, UserMessage } from '../../types/message.js'
import type { HookSuccessAttachment } from '../attachments.js'
import { capStoredPreEditFileCopy, isLoggableMessage } from '../sessionStorage.js'

function hookSuccess(overrides: Partial<HookSuccessAttachment> = {}): AttachmentMessage<HookSuccessAttachment> {
  return {
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    attachment: {
      type: 'hook_success',
      content: '',
      hookName: 'Stop',
      toolUseID: 'hook-1',
      hookEvent: 'Stop',
      ...overrides,
    },
  }
}

describe('capStoredPreEditFileCopy', () => {
  test('leaves non-objects and results without originalFile untouched', () => {
    expect(capStoredPreEditFileCopy(null)).toBeNull()
    expect(capStoredPreEditFileCopy('text')).toBe('text')
    const noOriginal = { filePath: '/tmp/a.ts', newString: 'x' }
    expect(capStoredPreEditFileCopy(noOriginal)).toBe(noOriginal)
  })

  test('keeps originalFile at or below 10k characters', () => {
    const result = { filePath: '/tmp/a.ts', originalFile: 'x'.repeat(10_000) }
    expect(capStoredPreEditFileCopy(result)).toBe(result)
  })

  test('drops originalFile above 10k characters, preserving other fields', () => {
    const result = { filePath: '/tmp/a.ts', originalFile: 'x'.repeat(10_001), replaceAll: true }
    expect(capStoredPreEditFileCopy(result)).toEqual({
      filePath: '/tmp/a.ts',
      originalFile: null,
      replaceAll: true,
    })
  })
})

describe('isLoggableMessage', () => {
  test('skips empty hook_success entries', () => {
    expect(isLoggableMessage(hookSuccess())).toBe(false)
    expect(isLoggableMessage(hookSuccess({ content: '', stdout: ' \n', stderr: '\t' }))).toBe(false)
  })

  test('keeps non-empty hook_success entries (ant transcripts)', () => {
    const previous = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    try {
      expect(isLoggableMessage(hookSuccess({ stdout: 'hook ran' }))).toBe(true)
      expect(isLoggableMessage(hookSuccess({ content: 'context' }))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.USER_TYPE
      else process.env.USER_TYPE = previous
    }
  })

  test('keeps ordinary user messages', () => {
    const user: UserMessage = {
      type: 'user',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'hello' },
    }
    expect(isLoggableMessage(user)).toBe(true)
  })
})
