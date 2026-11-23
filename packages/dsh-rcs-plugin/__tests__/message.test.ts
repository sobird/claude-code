import { describe, expect, test } from 'bun:test'

import { createUserMessage } from '../src/message'

describe('createUserMessage', () => {
  test('builds a frozen user message with a stable id and source', () => {
    const content = [{ type: 'text', text: 'hello' }]
    const message = createUserMessage(content)
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(message).toMatchObject({ role: 'user', content, source: { kind: 'user' } })
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
  })
})
