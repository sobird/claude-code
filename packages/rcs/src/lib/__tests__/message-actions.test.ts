import { describe, expect, test } from 'bun:test'

import { latestPrompt } from '../message-actions'
import type { ThreadEntry } from '../session-reducer'

function user(id: string, content: string): ThreadEntry {
  return { type: 'user_message', id, content }
}

function assistant(id: string): ThreadEntry {
  return { type: 'assistant_message', id, chunks: [], streaming: false }
}

describe('latestPrompt', () => {
  test('returns null when the thread has no prompts', () => {
    expect(latestPrompt([])).toBeNull()
    expect(latestPrompt([assistant('a1')])).toBeNull()
  })

  test('returns the most recent prompt', () => {
    expect(latestPrompt([user('u1', 'first'), assistant('a1'), user('u2', 'second')])).toBe('second')
  })

  test('ignores entries that follow the prompt', () => {
    expect(latestPrompt([user('u1', 'hello'), assistant('a1'), { type: 'turn_end', id: 't1', durationMs: 10 }])).toBe(
      'hello',
    )
  })

  test('skips blank prompts', () => {
    expect(latestPrompt([user('u1', 'kept'), user('u2', '   ')])).toBe('kept')
  })
})
