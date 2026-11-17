import { describe, expect, test } from 'bun:test'

import {
  copyTextForEntry,
  cursorEnterAction,
  latestPrompt,
  primaryInputOf,
  toolGroupCopyText,
} from '../message-actions'
import type { ThreadEntry, ToolCallEntry } from '../session-reducer'

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

describe('primaryInputOf', () => {
  test('maps each tool to its primary field', () => {
    expect(primaryInputOf('Read', { file_path: '/repo/a.ts' })).toEqual({ label: 'path', value: '/repo/a.ts' })
    expect(primaryInputOf('NotebookEdit', { notebook_path: '/repo/a.ipynb' })).toEqual({
      label: 'path',
      value: '/repo/a.ipynb',
    })
    expect(primaryInputOf('Bash', { command: 'bun test' })).toEqual({ label: 'command', value: 'bun test' })
    expect(primaryInputOf('Grep', { pattern: 'TODO' })).toEqual({ label: 'pattern', value: 'TODO' })
    expect(primaryInputOf('WebFetch', { url: 'https://x.test' })).toEqual({ label: 'url', value: 'https://x.test' })
    expect(primaryInputOf('WebSearch', { query: 'bun test' })).toEqual({ label: 'query', value: 'bun test' })
    expect(primaryInputOf('Agent', { prompt: 'go' })).toEqual({ label: 'prompt', value: 'go' })
  })

  test('joins tmux args', () => {
    expect(primaryInputOf('Tmux', { args: ['list-sessions'] })).toEqual({
      label: 'command',
      value: 'tmux list-sessions',
    })
  })

  test('returns null for unknown tools or missing fields', () => {
    expect(primaryInputOf('Unknown', { x: 'y' })).toBeNull()
    expect(primaryInputOf('Bash', {})).toBeNull()
    expect(primaryInputOf('Read', { file_path: 42 })).toBeNull()
  })
})

describe('copyTextForEntry', () => {
  test('user messages copy their content', () => {
    expect(copyTextForEntry(user('u1', 'hello'))).toBe('hello')
  })

  test('assistant messages copy prose and skip thoughts', () => {
    const entry: ThreadEntry = {
      type: 'assistant_message',
      id: 'a1',
      chunks: [
        { type: 'thought', text: 'hmm' },
        { type: 'message', text: 'answer' },
      ],
      streaming: false,
    }
    expect(copyTextForEntry(entry)).toBe('answer')
  })

  test('system rows fall back to the subtype', () => {
    expect(copyTextForEntry({ type: 'system', id: 's1', subtype: 'api_error' })).toBe('api_error')
    expect(copyTextForEntry({ type: 'system', id: 's2', subtype: 'compact_boundary', content: 'compacted' })).toBe(
      'compacted',
    )
  })

  test('turn markers copy nothing', () => {
    expect(copyTextForEntry({ type: 'turn_end', id: 't1', durationMs: 10 })).toBe('')
  })
})

function toolCall(id: string, output?: string, command?: string): ToolCallEntry {
  return {
    type: 'tool_call',
    toolCall: {
      id,
      title: 'Bash',
      status: output ? 'complete' : 'running',
      rawInput: command ? { command } : {},
      ...(output !== undefined ? { rawOutput: { output } } : {}),
    },
  }
}

describe('toolGroupCopyText', () => {
  test('joins settled outputs', () => {
    expect(toolGroupCopyText([toolCall('t1', 'one'), toolCall('t2', 'two')])).toBe('one\n\ntwo')
  })

  test('skips blank outputs and falls back to the newest primary input', () => {
    expect(toolGroupCopyText([toolCall('t1', 'one'), toolCall('t2')])).toBe('one')
    expect(toolGroupCopyText([toolCall('t1', undefined, 'first'), toolCall('t2', undefined, 'second')])).toBe('second')
  })

  test('returns an empty string when nothing is extractable', () => {
    expect(toolGroupCopyText([toolCall('t1')])).toBe('')
  })
})

describe('cursorEnterAction', () => {
  test('user edits, tools toggle, the rest do nothing', () => {
    expect(cursorEnterAction({ key: 'u1', kind: 'user' })).toBe('edit')
    expect(cursorEnterAction({ key: 't1', kind: 'tools' })).toBe('toggle')
    expect(cursorEnterAction({ key: 'a1', kind: 'assistant' })).toBeNull()
    expect(cursorEnterAction({ key: 's1', kind: 'system' })).toBeNull()
    expect(cursorEnterAction({ key: 'e1', kind: 'turn_end' })).toBeNull()
  })
})
