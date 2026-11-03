import { expect, test } from 'bun:test'

import { hookPermissionBehaviorSchema } from '../src/types/hooks'
import { permissionBehaviorSchema } from '../src/utils/permissions/PermissionRule'

test('defer is hook-only', () => {
  expect(hookPermissionBehaviorSchema().safeParse('defer').success).toBe(true)
  expect(permissionBehaviorSchema().safeParse('defer').success).toBe(false)
})
