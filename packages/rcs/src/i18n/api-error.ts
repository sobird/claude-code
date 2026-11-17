import { ApiError } from '../lib/api-client'
import { apiErrorKey } from './error-codes'

/** Translation key for an `ApiError` whose code has copy, otherwise `null`. */
export function errorTranslationKey(error: unknown): string | null {
  if (error instanceof ApiError && error.code) return apiErrorKey(error.code)
  return null
}
