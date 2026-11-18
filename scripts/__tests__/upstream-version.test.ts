import { expect, test } from 'bun:test'

import { UPSTREAM_VERSION } from '../upstream-version'

test('bunfig version matches upstream constant', async () => {
  const toml = await Bun.file('bunfig.toml').text()
  expect(toml).toContain(`"MACRO.VERSION" = "'${UPSTREAM_VERSION}'"`)
  expect(UPSTREAM_VERSION).toBe('2.1.90')
})
