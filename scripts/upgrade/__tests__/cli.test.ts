import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AlignResult, Inventory, StatusLedger, VerifyReport } from '../types'

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

function alignArgs(outDir: string): string[] {
  return [
    'align',
    '--reference',
    `${FIXTURES}/ref.js`,
    '--map',
    `${FIXTURES}/ref.js.map`,
    '--target',
    `${FIXTURES}/target.js`,
    '--out',
    outDir,
  ]
}

test('inventory writes a JSON inventory file', () => {
  const out = join(tempDir(), 'inv.json')
  const result = run(['inventory', '--bundle', `${FIXTURES}/mini-bundle.js`, '--out', out])
  expect(result.exitCode).toBe(0)
  expect(existsSync(out)).toBe(true)
  const inventory = JSON.parse(readFileSync(out, 'utf8')) as Inventory
  expect(inventory.commands.length).toBeGreaterThan(0)
})

test('align writes align.json to the out directory', () => {
  const out = tempDir()
  const result = run(alignArgs(out))
  expect(result.exitCode).toBe(0)
  const align = JSON.parse(readFileSync(join(out, 'align.json'), 'utf8')) as AlignResult
  expect(align.nodes.length).toBeGreaterThan(0)
  expect(align.source.map).toBe(true)
})

test('extract runs end-to-end from an align file', () => {
  const dir = tempDir()
  const alignOut = join(dir, 'align')
  expect(run(alignArgs(alignOut)).exitCode).toBe(0)

  const out = join(dir, 'extract')
  const result = run([
    'extract',
    '--align',
    join(alignOut, 'align.json'),
    '--target',
    `${FIXTURES}/target.js`,
    '--keywords',
    'alpha',
    '--out',
    out,
  ])
  expect(result.exitCode).toBe(0)
  expect(existsSync(join(out, 'candidates', '3-functiondeclaration.ts'))).toBe(true)
})

test('verify writes report files and returns 0 when the ledger is clean', () => {
  const dir = tempDir()
  const bundle = join(dir, 'bundle.js')
  writeFileSync(bundle, 'var a={type:"local",name:"demo"};\n')
  const srcDir = join(dir, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'commands.ts'), "export const cmd = { name: 'demo' }\n")

  const ledger: StatusLedger = { source: { reference: 'demo', target: 'demo' }, entries: [] }
  const statusPath = join(dir, 'status.json')
  writeFileSync(statusPath, JSON.stringify(ledger))

  const out = join(dir, 'report')
  const result = run([
    'verify',
    '--target',
    bundle,
    '--reference',
    bundle,
    '--src',
    srcDir,
    '--status',
    statusPath,
    '--out',
    out,
  ])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as VerifyReport
  expect(report.ok).toBe(true)
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
