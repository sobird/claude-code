import { afterEach, describe, expect, test } from 'bun:test'

import { setMemoryToggledOff } from '../../../bootstrap/state.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import { createAutoMemCanUseTool, hasUserProseSince } from '../extractMemories.js'

afterEach(() => {
  setMemoryToggledOff(false)
})

const readTool = { name: 'Read' } as unknown as Tool
// The hook's remaining parameters are unused by these permission checks.
const unusedToolUseContext = {} as ToolUseContext
const unusedAssistantMessage = {} as AssistantMessage

function userMessage(uuid: string, text: string, isMeta = false): Message {
  return {
    type: 'user',
    uuid,
    isMeta,
    message: { role: 'user', content: text },
  } as unknown as Message
}

describe('extractMemories with automemory toggled off', () => {
  test('denies every tool, including read-only ones', async () => {
    setMemoryToggledOff(true)

    const canUseTool = createAutoMemCanUseTool('/tmp/memory/')
    const result = await canUseTool(readTool, {}, unusedToolUseContext, unusedAssistantMessage, 'tool-use-id')

    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain('Memory is toggled off')
      expect(result.message).toContain('/toggle-memory')
    }
  })

  test('allows read-only tools when automemory is on', async () => {
    const canUseTool = createAutoMemCanUseTool('/tmp/memory/')
    expect((await canUseTool(readTool, {}, unusedToolUseContext, unusedAssistantMessage, 'tool-use-id')).behavior).toBe(
      'allow',
    )
  })
})

describe('hasUserProseSince', () => {
  test('requires at least three words of non-meta user prose', () => {
    const messages = [userMessage('a', 'fix the test'), userMessage('b', 'ok')]
    expect(hasUserProseSince(messages, undefined)).toBe(true)
    expect(hasUserProseSince([userMessage('c', 'ok')], undefined)).toBe(false)
  })

  test('ignores meta messages', () => {
    expect(hasUserProseSince([userMessage('a', 'one two three', true)], undefined)).toBe(false)
  })

  test('only scans messages after the cursor uuid', () => {
    const messages = [userMessage('cursor', 'one two three four'), userMessage('after', 'ok')]
    expect(hasUserProseSince(messages, 'cursor')).toBe(false)
    expect(hasUserProseSince(messages, undefined)).toBe(true)
  })
})
