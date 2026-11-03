import { expect, test } from 'bun:test'

import { features } from '../scripts/config'
import brief from '../src/commands/brief'

test('brief is enabled and named consistently', () => {
  expect(features).toContain('KAIROS_BRIEF')
  expect(brief.name).toBe('brief')
  expect(brief.description).toBe('Toggle brief-only mode')
  expect(brief.type).toBe('local-jsx')
})
