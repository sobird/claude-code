import { expect, test } from 'bun:test'

import { name, version } from '../../package.json'

/**
 * `bunfig.toml` holds the defines used by direct `bun test` runs; the build
 * and `bun run dev` take theirs from `scripts/config.ts`. The two must agree,
 * so both are derived from `package.json` — the fork's release version is what
 * the CLI reports, not the upstream release it tracks. release-please bumps
 * this file too (`extra-files` + the `x-release-please-version` marker on the
 * version line), so this test fails loudly if that sync ever breaks.
 */
test('bunfig defines match package.json', async () => {
  const toml = await Bun.file('bunfig.toml').text()
  expect(toml).toContain(`"MACRO.VERSION" = "'${version}'"`)
  expect(toml).toContain(`"MACRO.PACKAGE_URL" = "'${name}'"`)
})
