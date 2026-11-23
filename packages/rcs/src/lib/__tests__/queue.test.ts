import { describe, expect, test } from 'bun:test'

import { parseQueue } from '@/lib/queue'

describe('parseQueue', () => {
  test('reads the queue array from a normalized snapshot payload', () => {
    const queue = parseQueue({
      content: '',
      queue: [{ uuid: 'u1', content: 'hold on', priority: 'later', editable: true }],
    })
    expect(queue).toEqual([{ uuid: 'u1', content: 'hold on', priority: 'later', editable: true }])
  })

  test('defaults the priority and drops malformed rows', () => {
    const queue = parseQueue([
      { uuid: 'u1', content: 'no priority' },
      { uuid: '', content: 'no uuid' },
      { content: 'missing uuid' },
      'not a row',
      { uuid: 'u2', content: 42, priority: 'now', editable: 'yes' },
    ])
    expect(queue).toEqual([
      { uuid: 'u1', content: 'no priority', priority: 'next', editable: false },
      { uuid: 'u2', content: '', priority: 'now', editable: false },
    ])
  })

  test('treats unknown payloads as an empty queue', () => {
    expect(parseQueue(undefined)).toEqual([])
    expect(parseQueue(null)).toEqual([])
    expect(parseQueue({ queue: 'nope' })).toEqual([])
    expect(parseQueue('text')).toEqual([])
  })
})
