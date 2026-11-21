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
})

describe('errorTranslationKey', () => {
  test('maps known codes and ignores unknown ones', () => {
    expect(errorTranslationKey(new ApiError(404, 'x', 'session_not_found'))).toBe('errors.codes.session_not_found')
    expect(errorTranslationKey(new ApiError(400, 'x', 'not_a_real_code'))).toBeNull()
    expect(errorTranslationKey(new Error('plain'))).toBeNull()
  })
})
