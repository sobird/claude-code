import { expect, test } from 'bun:test'

import { scanBundle } from '../inventory'

test('extracts commands, env, flags, version, hash', async () => {
  const inv = await scanBundle('scripts/upgrade/__tests__/fixtures/mini-bundle.js')
  expect(inv.version).toBe('2.1.89')
  expect(inv.commands).toEqual([
    { type: 'local', name: 'alpha' },
    { type: 'prompt', name: 'beta' },
  ])
  expect(inv.envVars).toEqual(['CLAUDE_CODE_DEMO', 'MCP_CONNECTION_NONBLOCKING'])
  expect(inv.cliFlags).toEqual(['--channels', '--demo'])
  expect(inv.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(inv.bytes).toBeGreaterThan(0)
})
