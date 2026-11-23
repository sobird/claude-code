import { describe, expect, test } from 'bun:test'

import type { ThreadEntry } from '@/lib/session-reducer'

import { sameChildThreads, sameEntryList } from '../row-equality'

function user(id: string): ThreadEntry {
  return { type: 'user_message', id, content: id }
}

function turnEnd(id: string): ThreadEntry {
  return { type: 'turn_end', id, durationMs: 1 }
}

describe('sameEntryList', () => {
  test('accepts the same array and element-wise equal arrays', () => {
    const entries = [user('a'), turnEnd('b')]
    expect(sameEntryList(entries, entries)).toBe(true)
    expect(sameEntryList(entries, [...entries])).toBe(true)
  })

  test('rejects lists whose element references differ', () => {
    expect(sameEntryList([user('a')], [user('a')])).toBe(false)
  })

  test('rejects different lengths and presence', () => {
    expect(sameEntryList([user('a')], [user('a'), turnEnd('b')])).toBe(false)
    expect(sameEntryList(undefined, [user('a')])).toBe(false)
    expect(sameEntryList([user('a')], undefined)).toBe(false)
    expect(sameEntryList(undefined, undefined)).toBe(true)
  })
})

describe('sameChildThreads', () => {
  const child = (id: string): ThreadEntry[] => [user(id)]

  test('ignores a rebuilt map when each tool keeps the same children', () => {
    const children = child('x')
    const before = new Map<string, ThreadEntry[]>([['call-1', children]])
    const after = new Map<string, ThreadEntry[]>([['call-1', children]])
    expect(sameChildThreads(before, after, ['call-1'])).toBe(true)
  })

  test('detects a changed child thread', () => {
    const before = new Map<string, ThreadEntry[]>([['call-1', child('x')]])
    const after = new Map<string, ThreadEntry[]>([['call-1', [...child('x'), user('y')]]])
    expect(sameChildThreads(before, after, ['call-1'])).toBe(false)
  })

  test('detects a child list appearing or disappearing', () => {
    const empty = new Map<string, ThreadEntry[]>()
    const present = new Map<string, ThreadEntry[]>([['call-1', child('x')]])
    expect(sameChildThreads(empty, present, ['call-1'])).toBe(false)
    expect(sameChildThreads(present, empty, ['call-1'])).toBe(false)
  })

  test('only inspects the ids it is given', () => {
    const shared = child('x')
    const before = new Map<string, ThreadEntry[]>([
      ['call-1', shared],
      ['call-2', child('y')],
    ])
    const after = new Map<string, ThreadEntry[]>([
      ['call-1', shared],
      ['call-2', child('z')],
    ])
    expect(sameChildThreads(before, after, ['call-1'])).toBe(true)
  })
})
