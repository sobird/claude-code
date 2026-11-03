import { expect, test } from 'bun:test'

import { SettingsSchema } from '../src/utils/settings/types'

test('cleanupPeriodDays rejects zero', () => {
  expect(SettingsSchema().safeParse({ cleanupPeriodDays: 0 }).success).toBe(false)
  expect(SettingsSchema().safeParse({ cleanupPeriodDays: 1 }).success).toBe(true)
})
