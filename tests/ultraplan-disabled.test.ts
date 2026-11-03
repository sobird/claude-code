import { expect, test } from 'bun:test'

import { features } from '../scripts/config'

test('ultraplan is not part of the external surface', () => {
  expect(features).not.toContain('ULTRAPLAN')
})
