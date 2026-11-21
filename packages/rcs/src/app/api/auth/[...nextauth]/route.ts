/**
 * Auth.js route handler, served at `/api/auth/*` to match `AUTH_BASE_PATH` in
 * `lib/auth.config.ts`.
 */

import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
