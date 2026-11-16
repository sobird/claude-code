/**
 * Auth.js route handler.
 *
 * With Next's `basePath: '/code'` the physical endpoint base is
 * `/code/api/auth` (matching `AUTH_BASE_PATH` in `lib/auth.config.ts`).
 */

import { handlers } from '../../../../lib/auth'

export const { GET, POST } = handlers
