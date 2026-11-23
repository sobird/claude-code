import { describe, expect, test } from 'bun:test'

import { ApiError } from '@/lib/api-client'
import { readSessionActivity } from '@/lib/session-activity'

describe('readSessionActivity', () => {
  test('reads the activity list from a session_active ApiError', () => {
    const error = new ApiError(409, 'Session has active work', 'session_active', {
      activity: [{ kind: 'bridge', label: 'Connected bridge' }],
    })
    expect(readSessionActivity(error)).toEqual([{ kind: 'bridge', label: 'Connected bridge' }])
  })

  test('keeps the optional id', () => {
    const error = new ApiError(409, 'm', 'session_active', {
      activity: [{ kind: 'work_item', id: 'work_1', label: 'Queued work item' }],
    })
    expect(readSessionActivity(error)).toEqual([{ kind: 'work_item', id: 'work_1', label: 'Queued work item' }])
  })

  test('ignores errors that are not session_active', () => {
    expect(readSessionActivity(new ApiError(409, 'm', 'session_closed'))).toBeNull()
    expect(readSessionActivity(new ApiError(409, 'm'))).toBeNull()
    expect(readSessionActivity(new Error('plain'))).toBeNull()
    expect(readSessionActivity(null)).toBeNull()
  })

  test('returns an empty list when the payload has no usable activity', () => {
    expect(readSessionActivity(new ApiError(409, 'm', 'session_active'))).toEqual([])
    expect(readSessionActivity(new ApiError(409, 'm', 'session_active', {}))).toEqual([])
    expect(readSessionActivity(new ApiError(409, 'm', 'session_active', { activity: 'nope' }))).toEqual([])
  })

  test('drops malformed entries', () => {
    const error = new ApiError(409, 'm', 'session_active', {
      activity: [
        { kind: 'bridge', label: 'Connected bridge' },
        { kind: 1, label: 'bad kind' },
        null,
        { label: 'missing kind' },
        { kind: 'control' },
      ],
    })
    expect(readSessionActivity(error)).toEqual([{ kind: 'bridge', label: 'Connected bridge' }])
  })
})
