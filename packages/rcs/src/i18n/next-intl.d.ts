/**
 * AppConfig augmentation for next-intl.
 *
 * Keys and interpolation params are checked against the English catalog; the
 * zh-CN catalog is kept key-compatible by `catalogs.test.ts`.
 *
 * Augmenting `next-intl` (rather than `use-intl`) is the supported entry point:
 * next-intl re-exports use-intl's `AppConfig`, so this propagates to
 * `useTranslations` and `useLocale`.
 */

import messages from '../../messages/en.json'
import type { Locale } from './locales'

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof messages
  }
}
