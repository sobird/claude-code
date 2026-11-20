import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Inventory } from '../types'

const CLI = 'scripts/upgrade/cli.ts'
const FIXTURES = 'scripts/upgrade/__tests__/fixtures'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `cli-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: ['bun', CLI, ...args], stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

test('inventory writes a JSON inventory file', () => {
  const out = join(tempDir(), 'inv.json')
  const result = run(['inventory', '--bundle', `${FIXTURES}/mini-bundle.js`, '--out', out])
  expect(result.exitCode).toBe(0)
  expect(existsSync(out)).toBe(true)
  const inventory = JSON.parse(readFileSync(out, 'utf8')) as Inventory
  expect(inventory.commands.length).toBeGreaterThan(0)
})

test('--help prints usage and exits 0', () => {
  const result = run(['--help'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('inventory')
  expect(result.stdout).toContain('prior-align')
})

test('unknown subcommand prints usage to stderr and exits 1', () => {
  const result = run(['nope'])
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('inventory')
})

test('missing subcommand exits 1', () => {
  const result = run([])
  expect(result.exitCode).toBe(1)
})
