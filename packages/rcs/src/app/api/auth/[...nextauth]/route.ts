/**
 * Auth.js route handler, served at `/api/auth/*` to match `AUTH_BASE_PATH` in
 * `auth/next/config.ts`.
 */

import { handlers } from '@/auth/next'

export const { GET, POST } = handlers
