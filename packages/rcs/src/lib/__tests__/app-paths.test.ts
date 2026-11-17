// src/lib/__tests__/app-paths.test.ts
import { describe, expect, test } from 'bun:test'

import { PREFERENCES_PATH } from '../app-paths'

test('the preferences endpoint is same-origin from the root', () => {
  expect(PREFERENCES_PATH).toBe('/api/preferences')
})
