import { afterEach, describe, expect, it } from 'bun:test'

import {
  cancelBridgeRequest,
  clearBridgeResponses,
  hasPendingControlRequests,
  MAX_SUGGESTION_PATHS,
  modelOptionsFromResponse,
  requestBridgeControl,
  settleBridgeResponse,
  sideQuestionAnswerFromResponse,
  sideQuestionErrorFromResponse,
  suggestionPathsFromResponse,
} from '@/transport/bridge-requests'

const pending = new Set<Promise<unknown>>()

function request(sessionId: string, requestId: string, timeoutMs = 50) {
  const promise = requestBridgeControl(sessionId, requestId, { subtype: 'file_suggestions' }, timeoutMs)
  pending.add(promise)
  return promise
}

afterEach(() => {
  for (const promise of pending) void promise
  pending.clear()
  clearBridgeResponses('s1')
  clearBridgeResponses('s2')
})

describe('requestBridgeControl', () => {
  it('resolves with the matching control_response', async () => {
    const promise = request('s1', 'r1')
    expect(settleBridgeResponse('s1', { subtype: 'success', request_id: 'r1', response: { suggestions: ['a'] } })).toBe(
      true,
    )
    await expect(promise).resolves.toEqual({ subtype: 'success', request_id: 'r1', response: { suggestions: ['a'] } })
  })

  it('ignores responses for another session or request id', async () => {
    const promise = request('s1', 'r1')
    expect(settleBridgeResponse('s2', { request_id: 'r1' })).toBe(false)
    expect(settleBridgeResponse('s1', { request_id: 'other' })).toBe(false)
    expect(settleBridgeResponse('s1', {})).toBe(false)
    settleBridgeResponse('s1', { request_id: 'r1' })
    await expect(promise).resolves.toEqual({ request_id: 'r1' })
  })

  it('resolves null after the timeout', async () => {
    await expect(request('s1', 'r1', 10)).resolves.toBeNull()
    expect(settleBridgeResponse('s1', { request_id: 'r1' })).toBe(false)
  })

  it('clears every pending request for a session', async () => {
    const promise = request('s1', 'r1')
    clearBridgeResponses('s1')
    await expect(promise).resolves.toBeNull()
    expect(settleBridgeResponse('s1', { request_id: 'r1' })).toBe(false)
  })

  it('settles a cancelled request with null and drops its waiter', async () => {
    const promise = request('s1', 'r1')
    cancelBridgeRequest('s1', 'r1')
    await expect(promise).resolves.toBeNull()
    expect(settleBridgeResponse('s1', { request_id: 'r1' })).toBe(false)
  })

  it('reports whether a session has a pending control request', async () => {
    expect(hasPendingControlRequests('s1')).toBe(false)

    const promise = request('s1', 'r1')
    expect(hasPendingControlRequests('s1')).toBe(true)
    expect(hasPendingControlRequests('s2')).toBe(false)

    settleBridgeResponse('s1', { request_id: 'r1' })
    await promise
    expect(hasPendingControlRequests('s1')).toBe(false)
  })
})

describe('modelOptionsFromResponse', () => {
  it('extracts models from the initialize success payload', () => {
    expect(
      modelOptionsFromResponse({
        subtype: 'success',
        response: {
          models: [
            { value: 'sonnet', displayName: 'Sonnet' },
            { value: 'opus', displayName: 'Opus' },
          ],
        },
      }),
    ).toEqual([
      { value: 'sonnet', displayName: 'Sonnet' },
      { value: 'opus', displayName: 'Opus' },
    ])
  })

  it('returns an empty list for errors and malformed payloads', () => {
    expect(modelOptionsFromResponse({ subtype: 'error', response: { models: [] } })).toEqual([])
    expect(modelOptionsFromResponse(null)).toEqual([])
    expect(modelOptionsFromResponse('nope')).toEqual([])
    expect(modelOptionsFromResponse({ subtype: 'success', response: { models: 'nope' } })).toEqual([])
    expect(modelOptionsFromResponse({ subtype: 'success' })).toEqual([])
  })

  it('skips bad entries', () => {
    expect(modelOptionsFromResponse({ subtype: 'success', response: { models: [{}, { value: 'sonnet' }] } })).toEqual([
      { value: 'sonnet', displayName: 'sonnet' },
    ])
  })
})

describe('sideQuestionAnswerFromResponse', () => {
  it('extracts the answer from the success payload', () => {
    expect(
      sideQuestionAnswerFromResponse({
        subtype: 'success',
        request_id: 'sq',
        // print.ts wraps runSideQuestion's `response` one level deeper.
        response: { response: 'The answer.' },
      }),
    ).toBe('The answer.')
  })

  it('returns null for empty answers and malformed payloads', () => {
    expect(sideQuestionAnswerFromResponse({ subtype: 'success', response: { response: '   ' } })).toBeNull()
    expect(sideQuestionAnswerFromResponse({ subtype: 'success', response: { response: null } })).toBeNull()
    expect(sideQuestionAnswerFromResponse({ subtype: 'success', response: { response: 42 } })).toBeNull()
    expect(sideQuestionAnswerFromResponse({ subtype: 'success', response: null })).toBeNull()
    expect(sideQuestionAnswerFromResponse({ subtype: 'error', error: 'boom' })).toBeNull()
    expect(sideQuestionAnswerFromResponse(null)).toBeNull()
    expect(sideQuestionAnswerFromResponse('nope')).toBeNull()
  })
})

describe('sideQuestionErrorFromResponse', () => {
  it('extracts the error message', () => {
    expect(sideQuestionErrorFromResponse({ subtype: 'error', request_id: 'sq', error: 'overloaded' })).toBe(
      'overloaded',
    )
  })

  it('returns null for success and malformed payloads', () => {
    expect(sideQuestionErrorFromResponse({ subtype: 'success', response: { response: 'ok' } })).toBeNull()
    expect(sideQuestionErrorFromResponse({ subtype: 'error', error: '' })).toBeNull()
    expect(sideQuestionErrorFromResponse({ subtype: 'error', error: 500 })).toBeNull()
    expect(sideQuestionErrorFromResponse(null)).toBeNull()
  })
})

describe('suggestionPathsFromResponse', () => {
  it('extracts the success payload', () => {
    expect(
      suggestionPathsFromResponse({
        subtype: 'success',
        response: { suggestions: ['src/b.ts', 'src/a.ts'] },
      }),
    ).toEqual(['src/b.ts', 'src/a.ts'])
  })

  it('rejects error responses, non-arrays, and non-string entries', () => {
    expect(suggestionPathsFromResponse({ subtype: 'error', response: { suggestions: ['a'] } })).toEqual([])
    expect(suggestionPathsFromResponse({ subtype: 'success', response: { suggestions: 'a' } })).toEqual([])
    expect(suggestionPathsFromResponse({ subtype: 'success', response: { suggestions: [1, null, 'a'] } })).toEqual([
      'a',
    ])
    expect(suggestionPathsFromResponse(null)).toEqual([])
    expect(suggestionPathsFromResponse('nope')).toEqual([])
  })

  it('drops blanks and duplicates and caps the list', () => {
    const many = Array.from({ length: MAX_SUGGESTION_PATHS + 5 }, (_, i) => `f${i}.ts`)
    const paths = suggestionPathsFromResponse({
      subtype: 'success',
      response: { suggestions: ['', '  ', 'a.ts', 'a.ts', ...many] },
    })
    expect(paths).toHaveLength(MAX_SUGGESTION_PATHS)
    expect(paths[0]).toBe('a.ts')
  })
})
