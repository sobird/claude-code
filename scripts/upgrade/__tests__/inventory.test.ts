import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanBundle } from '../inventory'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `inventory-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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

test('does not fabricate extra env names absent from the bundle', async () => {
  const dir = tempDir()
  const path = join(dir, 'bundle.js')
  writeFileSync(path, "var a = { type: 'local', name: 'alpha' }\nconst e = process.env.CLAUDE_CODE_DEMO\n")
  const inv = await scanBundle(path)
  expect(inv.envVars).toEqual(['CLAUDE_CODE_DEMO'])
  expect(inv.envVars).not.toContain('MCP_CONNECTION_NONBLOCKING')
})

test('detects an extra env name when present in the bundle', async () => {
  const dir = tempDir()
  const path = join(dir, 'bundle.js')
  writeFileSync(path, 'const m = process.env.MCP_CONNECTION_NONBLOCKING\n')
  const inv = await scanBundle(path)
  expect(inv.envVars).toContain('MCP_CONNECTION_NONBLOCKING')
})
