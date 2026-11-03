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

const DEFAULT_TARGET = 'var a={type:"local",name:"new"};x.option("--newflag");'
const DEFAULT_REFERENCE = 'var a={type:"local",name:"old"};process.env.CLAUDE_CODE_OLD;x.option("--oldflag");'
const DEFAULT_SRC = [
  "export const cmd = { name: 'new' }",
  "export const cmd2 = { name: 'old' }",
  "export const env = 'CLAUDE_CODE_OLD MCP_CONNECTION_NONBLOCKING'",
].join('\n')

type SetupOptions = { target?: string; reference?: string; src?: string }

async function setup(entries: StatusEntry[], opts: SetupOptions = {}) {
  const dir = tempDir()
  const targetPath = join(dir, 'target.js')
  const referencePath = join(dir, 'reference.js')
  writeFileSync(targetPath, opts.target ?? DEFAULT_TARGET)
  writeFileSync(referencePath, opts.reference ?? DEFAULT_REFERENCE)
  writeFileSync(join(dir, 'src.ts'), opts.src ?? DEFAULT_SRC)
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

test('unledgered flag difference stays advisory and does not fail', async () => {
  const paths = await setup(
    [
      entry('cmd:new', 'ported'),
      entry('cmd:old', 'retained-internal'),
      entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
    ],
    { src: `${DEFAULT_SRC}\nexport const flag = '--oldflag'` },
  )
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
  expect(r.missingInSrc).not.toContain('flag:--newflag')
  expect(r.unexpectedInSrc).not.toContain('flag:--oldflag')
})

test('ledgered ported flag missing from target fails', async () => {
  const paths = await setup(
    [
      entry('cmd:new', 'ported'),
      entry('cmd:old', 'retained-internal'),
      entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
      entry('flag:--oldflag', 'ported'),
    ],
    { src: `${DEFAULT_SRC}\nexport const flag = '--oldflag'` },
  )
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.unexpectedInSrc).toContain('flag:--oldflag')
})

test('ledgered flag present in both bundles passes as already-present', async () => {
  const paths = await setup(
    [
      entry('cmd:new', 'ported'),
      entry('cmd:old', 'retained-internal'),
      entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
      entry('flag:--bothflag', 'already-present'),
    ],
    {
      target: `${DEFAULT_TARGET}x.option("--bothflag");`,
      reference: `${DEFAULT_REFERENCE}x.option("--bothflag");`,
    },
  )
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
  expect(r.missingInSrc).toEqual([])
  expect(r.unexpectedInSrc).toEqual([])
})

test('target-only ledgered flag led already-present fails despite src presence', async () => {
  const paths = await setup(
    [
      entry('cmd:new', 'ported'),
      entry('cmd:old', 'retained-internal'),
      entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
      entry('flag:--newflag', 'already-present'),
    ],
    { src: `${DEFAULT_SRC}\nexport const flag = '--newflag'` },
  )
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.missingInSrc).toContain('flag:--newflag')
})

test('removal ledgered flag led ported fails despite src absence', async () => {
  const paths = await setup([
    entry('cmd:new', 'ported'),
    entry('cmd:old', 'retained-internal'),
    entry('env:CLAUDE_CODE_OLD', 'retained-internal'),
    entry('flag:--oldflag', 'ported'),
  ])
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.unexpectedInSrc).toContain('flag:--oldflag')
})

test('double-quoted command name in src is recognized', async () => {
  const paths = await setup([entry('cmd:new', 'already-present'), entry('cmd:old', 'retained-internal')], {
    target: 'var a={type:"local",name:"new"};',
    reference: 'var a={type:"local",name:"old"};',
    src: ['export const cmd = { name: "new" }', 'export const cmd2 = { name: "old" }'].join('\n'),
  })
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
})

test('MCP_CONNECTION_NONBLOCKING is not required when absent from both bundles', async () => {
  const paths = await setup([entry('cmd:new', 'ported'), entry('env:CLAUDE_CODE_OLD', 'retained-internal')], {
    src: ["export const cmd = { name: 'new' }", "export const env = 'CLAUDE_CODE_OLD'"].join('\n'),
  })
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(true)
  expect(r.missingInSrc).not.toContain('env:MCP_CONNECTION_NONBLOCKING')
  expect(r.unregistered).not.toContain('env:MCP_CONNECTION_NONBLOCKING')
})

test('env substring does not satisfy a shorter env name', async () => {
  const paths = await setup([entry('cmd:new', 'ported')], {
    target: 'process.env.CLAUDE_CODE_FOO;var a={type:"local",name:"new"}',
    reference: 'var a={type:"local",name:"old"}',
    src: ["export const cmd = { name: 'new' }", "export const env = 'CLAUDE_CODE_FOOBAR'"].join('\n'),
  })
  const r = await verifyUpgrade(paths)
  expect(r.ok).toBe(false)
  expect(r.unregistered).toContain('env:CLAUDE_CODE_FOO')
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
  expect(md).toContain('| Status             | Count |')
  expect(md).toContain('Unregistered')
  expect(md).toContain('cmd:old')
})
