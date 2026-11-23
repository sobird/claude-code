import { describe, expect, test } from 'bun:test'

import { errorTranslationKey } from '@/i18n/api-error'
import { ApiError, extractApiError, extractErrorMessage } from '@/lib/api-client'

describe('extractApiError', () => {
  test('reads flat Web errors', () => {
    expect(extractApiError({ error: 'nope', code: 'session_not_found' })).toEqual({
      code: 'session_not_found',
      message: 'nope',
    })
  })

  test('reads nested gateway errors and falls back to the type', () => {
    expect(extractApiError({ error: { type: 'forbidden', message: 'Not your session' } })).toEqual({
      code: 'forbidden',
      message: 'Not your session',
    })
    expect(extractApiError({ error: { type: 'x', message: 'm', code: 'session_closed' } }).code).toBe('session_closed')
  })

  test('extractErrorMessage keeps the old message behavior', () => {
    expect(extractErrorMessage({ error: { type: 'x', message: 'm' } }, 'fallback')).toBe('m')
    expect(extractErrorMessage({}, 'fallback')).toBe('fallback')
  })

  test('keeps nested details for structured errors', () => {
    expect(
      extractApiError({
        error: { type: 'session_active', message: 'Session has active work', details: { activity: [] } },
      }),
    ).toEqual({ code: 'session_active', message: 'Session has active work', details: { activity: [] } })
  })
})

describe('ApiError', () => {
  test('carries optional structured details', () => {
    const error = new ApiError(409, 'Session has active work', 'session_active', { activity: [] })
    expect(error.details).toEqual({ activity: [] })
    expect(new ApiError(409, 'm').details).toBeUndefined()
  })
})

describe('errorTranslationKey', () => {
  test('maps known codes and ignores unknown ones', () => {
    expect(errorTranslationKey(new ApiError(404, 'x', 'session_not_found'))).toBe('errors.codes.session_not_found')
    expect(errorTranslationKey(new ApiError(400, 'x', 'not_a_real_code'))).toBeNull()
    expect(errorTranslationKey(new Error('plain'))).toBeNull()
  })
})
