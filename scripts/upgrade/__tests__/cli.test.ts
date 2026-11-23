import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('features writes markdown and JSON from the four inputs', () => {
  const dir = tempDir()
  const emptyInventory = {
    version: '2.0.0',
    sha256: '',
    bytes: 0,
    commands: [],
    envVars: [],
    cliFlags: [],
    strings: [],
  }
  const reference = join(dir, 'reference.json')
  const target = join(dir, 'target.json')
  const status = join(dir, 'status.json')
  const notes = join(dir, 'notes.json')
  const out = join(dir, 'out')
  writeFileSync(reference, JSON.stringify({ ...emptyInventory, envVars: ['OLD'] }))
  writeFileSync(
    target,
    JSON.stringify({ ...emptyInventory, commands: [{ type: 'local', name: 'new' }], envVars: ['NEW'] }),
  )
  writeFileSync(
    status,
    JSON.stringify({
      source: { reference: '1.0.0', target: '2.0.0' },
      entries: [{ id: 'env:OLD', kind: 'env', status: 'retained-internal', evidence: [] }],
    }),
  )
  writeFileSync(notes, JSON.stringify({ version: 'v2', items: ['Added a command'] }))

  const result = run([
    'features',
    '--status',
    status,
    '--reference-inventory',
    reference,
    '--target-inventory',
    target,
    '--release-notes',
    notes,
    '--out',
    out,
  ])
  expect(result.exitCode).toBe(0)
  expect(existsSync(join(out, 'features.md'))).toBe(true)
  const report = JSON.parse(readFileSync(join(out, 'features.json'), 'utf8')) as {
    counts: { added: number; retained: number; synced: number; releaseItems: number }
  }
  expect(report.counts).toMatchObject({ added: 2, retained: 1, synced: 0, releaseItems: 1 })
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
