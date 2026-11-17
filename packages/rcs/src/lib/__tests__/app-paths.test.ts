// src/lib/__tests__/app-paths.test.ts
import { describe, expect, test } from 'bun:test'

import { APP_BASE_PATH, PREFERENCES_PATH, toActionRedirectPath } from '../app-paths'

test('the preferences endpoint is same-origin under the app base path', () => {
  expect(APP_BASE_PATH).toBe('/code')
  expect(PREFERENCES_PATH).toBe('/code/api/preferences')
})

describe('toActionRedirectPath', () => {
  test('strips the base path because server-action redirects add it back', () => {
    expect(toActionRedirectPath('/code')).toBe('/')
    expect(toActionRedirectPath('/code/settings?tab=keys')).toBe('/settings?tab=keys')
    expect(toActionRedirectPath('/settings')).toBe('/settings')
  })
})
