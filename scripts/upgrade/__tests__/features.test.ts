import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildFeaturesReport, type FeaturesInput, renderFeaturesMarkdown, writeFeaturesReport } from '../features'
import type { CommandEntry, Inventory, StatusEntry, StatusLedger } from '../types'

function inventory(commands: string[], envVars: string[], cliFlags: string[] = [], version = '2.0.0'): Inventory {
  return {
    version,
    sha256: '',
    bytes: 0,
    commands: commands.map((name): CommandEntry => ({ type: 'local', name })),
    envVars,
    cliFlags,
    strings: [],
  }
}

function ledger(entries: StatusEntry[], source = { reference: '1.0.0', target: '2.0.0' }): StatusLedger {
  return { source, entries }
}

function entry(id: string, status: StatusEntry['status'], releaseItems?: number[]): StatusEntry {
  return releaseItems === undefined
    ? { id, kind: id.slice(0, id.indexOf(':')), status, evidence: [] }
    : { id, kind: id.slice(0, id.indexOf(':')), status, evidence: [], releaseItems }
}

const NOTES = { version: 'v2', items: ['Added thing one', 'Fixed thing two'] }

test('detects added commands, env vars, and flags', () => {
  const report = buildFeaturesReport({
    reference: inventory(['old'], ['OLD'], ['--old']),
    target: inventory(['old', 'new'], ['OLD', 'NEW'], ['--old', '--new']),
    ledger: ledger([]),
    notes: NOTES,
  })
  expect(report.added.commands).toEqual([{ type: 'local', name: 'new' }])
  expect(report.added.envVars).toEqual(['NEW'])
  expect(report.added.cliFlags).toEqual(['--new'])
  expect(report.counts.added).toBe(3)
})

test('splits reference-only ids into retained and synced using the ledger', () => {
  const report = buildFeaturesReport({
    reference: inventory([], ['KEEP', 'DROP']),
    target: inventory([], []),
    ledger: ledger([
      entry('env:KEEP', 'retained-internal'),
      // Not in either inventory: the ledger is authoritative (prefix-scan gap).
      entry('env:REPL_MODE', 'retained-internal'),
    ]),
    notes: NOTES,
  })
  expect(report.removed.retained.map((row) => row.id)).toEqual(['env:KEEP', 'env:REPL_MODE'])
  expect(report.removed.synced).toEqual(['env:DROP'])
  expect(report.counts.retained).toBe(2)
  expect(report.counts.synced).toBe(1)
})

test('maps every release item and reports uncovered ones', () => {
  const report = buildFeaturesReport({
    reference: inventory([], []),
    target: inventory([], []),
    ledger: ledger([
      entry('behavior:x', 'ported', [1, 2]),
      entry('behavior:y', 'approximated', [2]),
      entry('behavior:noise', 'approximated'),
    ]),
    notes: { version: 'v3', items: ['one', 'two', 'three'] },
  })
  expect(report.releaseItems.map((row) => row.item)).toEqual([1, 2, 3])
  expect(report.releaseItems[1].entries.map((ref) => ref.id)).toEqual(['behavior:x', 'behavior:y'])
  expect(report.uncovered).toEqual([3])
  expect(report.unreferenced.map((ref) => ref.id)).toEqual(['behavior:noise'])
})

test('renderFeaturesMarkdown escapes cells, truncates, and ends with a newline', () => {
  const longText = 'Added | piped text with ENV_RE and ENABLE_/DISABLE and then padding '.repeat(4)
  const markdown = renderFeaturesMarkdown(
    buildFeaturesReport({
      reference: inventory([], []),
      target: inventory([], ['NEW']),
      ledger: ledger([]),
      notes: { version: 'v2', items: [longText] },
    }),
  )
  expect(markdown.startsWith('# 功能变更报告 1.0.0 → 2.0.0')).toBe(true)
  expect(markdown).toContain('## 新增功能点（inventory）')
  expect(markdown).toContain('- `NEW`')
  expect(markdown).toContain('_none_')
  expect(markdown).toContain('Added \\| piped text')
  expect(markdown).toContain('ENV_RE')
  expect(markdown).toContain('ENABLE\\_/DISABLE')
  expect(markdown).toContain('…')
  expect(markdown.endsWith('\n')).toBe(true)
})

test('writeFeaturesReport writes oxfmt-safe JSON and markdown', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'features-'))
  try {
    const input: FeaturesInput = {
      reference: inventory([], ['OLD']),
      target: inventory(['new'], ['NEW']),
      ledger: ledger([entry('env:OLD', 'retained-internal')]),
      notes: NOTES,
    }
    const report = buildFeaturesReport(input)
    await writeFeaturesReport(report, outDir)
    const json = JSON.parse(readFileSync(join(outDir, 'features.json'), 'utf8')) as typeof report
    expect(json).toEqual(report)
    expect(readFileSync(join(outDir, 'features.md'), 'utf8')).toContain('## 全量 release items')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

const REAL = '/tmp/up2100'
if (existsSync(`${REAL}/inventory-2.1.94.json`)) {
  test('2.1.100 artifacts produce 104 covered items with buddy and REPL retained', () => {
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
    const ledgerPath = 'docs/upgrade/2.1.100/status.json'
    const report = buildFeaturesReport({
      reference: read(`${REAL}/inventory-2.1.94.json`) as Inventory,
      target: read(`${REAL}/inventory-2.1.100.json`) as Inventory,
      ledger: read(ledgerPath) as StatusLedger,
      notes: read(`${REAL}/release-notes-94-100.json`) as { version: string; items: string[] },
    })
    expect(report.source).toEqual({ reference: '2.1.94', target: '2.1.100' })
    expect(report.counts.releaseItems).toBe(104)
    expect(report.counts.uncovered).toBe(0)
    expect(report.removed.retained.map((row) => row.id)).toEqual(['cmd:buddy', 'env:CLAUDE_CODE_REPL'])
    expect(report.removed.synced).toEqual(['env:CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT'])
  })
}
