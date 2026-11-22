import { ApiError } from '@/lib/api-client'

import { apiErrorKey, type ErrorCodeKey } from './error-codes'

/** Translation key for an `ApiError` whose code has copy, otherwise `null`. */
export function errorTranslationKey(error: unknown): ErrorCodeKey | null {
  if (error instanceof ApiError && error.code) return apiErrorKey(error.code)
  return null
}
