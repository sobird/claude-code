'use client'

/**
 * Returns a `describeError(error, fallbackKey)` helper for components.
 *
 * Known server error codes resolve to localized copy, unknown errors keep the
 * server's own message, and anything else falls back to the provided catalog
 * key. Components bind it once (`const describeError = useApiErrorMessage()`)
 * so the hook obeys the rules of hooks.
 */

import { useTranslations } from 'next-intl'

import { errorTranslationKey } from '../i18n/api-error'

export function useApiErrorMessage(): (error: unknown, fallbackKey: string) => string {
  const t = useTranslations()
  return (error, fallbackKey) => {
    const key = errorTranslationKey(error)
    if (key) return t(key)
    if (error instanceof Error && error.message.length > 0) return error.message
    return t(fallbackKey)
  }
}
