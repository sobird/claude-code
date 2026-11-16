import { expect, test } from 'bun:test'

import pkg from '../../package.json'

test('package name and scripts', () => {
  expect(pkg.name).toBe('@sobird/rcs')
  expect(pkg.private).toBe(true)
  expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
})
