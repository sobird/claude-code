/**
 * Auth.js `User`/`Session` augmentation for the claims we expose to app code.
 *
 * The `jwt`/`session` callbacks in `auth.config.ts` see Auth.js's internal
 * (`User | AdapterUser`) types and map claims through a local view; this
 * augmentation types the published `auth()` result and `unstable_update` input.
 */

import type { Role } from '@/contracts'
import type { Locale } from '@/i18n/locales'

declare module 'next-auth' {
  interface User {
    role?: Role
    locale?: Locale | null
  }
}
