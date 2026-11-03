import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeReport } from '../report'
import type { StatusEntry, StatusLedger } from '../types'
import { verifyUpgrade } from '../verify'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `verify-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

function entry(id: string, status: StatusEntry['status']): StatusEntry {
  return { id, kind: id.split(':')[0], status, evidence: [] }
}

function writeLedger(dir: string, entries: StatusEntry[]): string {
  const ledger: StatusLedger = { source: { reference: 'ref', target: 'tgt' }, entries }
  const path = join(dir, 'status.json')
  writeFileSync(path, JSON.stringify(ledger))
  return path
}

async function setup(entries: StatusEntry[]) {
  const dir = tempDir()
  const targetPath = join(dir, 'target.js')
  const referencePath = join(dir, 'reference.js')
  writeFileSync(targetPath, 'var a={type:"local",name:"new"};x.option("--newflag");')
  writeFileSync(referencePath, 'var a={type:"local",name:"old"};process.env.CLAUDE_CODE_OLD;x.option("--oldflag");')
  writeFileSync(
    join(dir, 'src.ts'),
    [
      "export const cmd = { name: 'new' }",
      "export const cmd2 = { name: 'old' }",
      "export const env = 'CLAUDE_CODE_OLD MCP_CONNECTION_NONBLOCKING'",
    ].join('\n'),
  )
  const statusPath = writeLedger(dir, entries)
  return { dir, targetPath, referencePath, srcDir: dir, statusPath }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('fails on unregistered removal', async () => {
  const paths = await setup([entry('cmd:new', 'ported'), entry('env:CLAUDE_CODE_OLD', 'retained-internal')])
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.unregistered).toContain('cmd:old')
})

test('passes retained-internal removal and ported addition', async () => {
  const paths = await setup([
    entry('cmd:new', 'ported'),
    entry('cmd:old', 'retained-internal'),
    entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
  ])
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
  expect(r.missingInSrc).toEqual([])
  expect(r.unexpectedInSrc).toEqual([])
  expect(r.unregistered).toEqual([])
  expect(r.unresolved).toEqual([])
})

test('fails on unresolved', async () => {
  const paths = await setup([
    entry('cmd:new', 'ported'),
    entry('cmd:old', 'retained-internal'),
    entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
    entry('flag:--mystery', 'unresolved'),
  ])
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.unresolved).toContain('flag:--mystery')
})

test('flag advisory without ledger entry does not fail and is omitted', async () => {
  const paths = await setup([
    entry('cmd:new', 'ported'),
    entry('cmd:old', 'retained-internal'),
    entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
  ])
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
  expect(r.missingInSrc).not.toContain('flag:--newflag')
  expect(r.unexpectedInSrc).not.toContain('flag:--oldflag')
})

test('counts every status from the ledger', async () => {
  const paths = await setup([
    entry('cmd:new', 'ported'),
    entry('cmd:old', 'retained-internal'),
    entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
  ])
  const r = await verifyUpgrade(paths)
  expect(r.counts).toEqual({
    'already-present': 0,
    ported: 1,
    approximated: 0,
    'ignored-dependency': 0,
    'retained-internal': 2,
    unresolved: 0,
  })
})

test('writeReport writes report.json and report.md', async () => {
  const paths = await setup([entry('cmd:new', 'ported')])
  const r = await verifyUpgrade(paths)
  const outDir = join(paths.dir, 'out', 'nested')
  await writeReport(r, outDir)

  const json = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'))
  expect(json.unregistered).toContain('cmd:old')
  const md = readFileSync(join(outDir, 'report.md'), 'utf8')
  expect(md).toContain('# Upgrade verification report')
  expect(md).toContain('| Status | Count |')
  expect(md).toContain('Unregistered')
  expect(md).toContain('cmd:old')
})
