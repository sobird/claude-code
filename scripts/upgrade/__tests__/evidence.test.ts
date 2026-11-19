import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkEvidence, refreshEvidence } from '../evidence'
import type { StatusEntry } from '../types'

const TARGET = 'var a={type:"local",name:"demo"};process.env.CLAUDE_CODE_DEMO;tengu_demo_flag;var s="[shell]";'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `evidence-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function check(entry: Partial<StatusEntry>, targetText = TARGET): string[] {
  const full: StatusEntry = { id: 'env:CLAUDE_CODE_DEMO', kind: 'env', status: 'ported', evidence: [], ...entry }
  return checkEvidence([full], { targetText, scenariosDir: 'scripts/upgrade/scenarios', repoRoot: process.cwd() })
}

test('accepts an env offset that starts the identifier', () => {
  const offset = TARGET.indexOf('CLAUDE_CODE_DEMO')
  expect(check({ evidence: [`bundle:${offset}`] })).toEqual([])
})

test('rejects an env offset that points elsewhere', () => {
  expect(check({ evidence: ['bundle:0'] })).toEqual([
    'env:CLAUDE_CODE_DEMO: bundle:0 does not point at CLAUDE_CODE_DEMO',
  ])
})

test('rejects out-of-range and non-token offsets', () => {
  expect(check({ evidence: ['bundle:999999'] })).toEqual([
    'env:CLAUDE_CODE_DEMO: bundle:999999 is outside the target bundle',
  ])
  const brace = TARGET.indexOf('{')
  expect(check({ evidence: [`bundle:${brace}`] }, TARGET)).toEqual([
    `env:CLAUDE_CODE_DEMO: bundle:${brace} points at "{", not a literal or identifier`,
  ])
})

test('accepts offsets inside a literal, including punctuation', () => {
  const bracket = TARGET.indexOf('[')
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: [`bundle:${bracket}`] })).toEqual([])
})

test('checks string, absent and no-name evidence', () => {
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: ['bundle:tengu_demo_flag'] })).toEqual([])
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: ['bundle:absent:tengu_missing'] })).toEqual([])
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: ['bundle:absent:tengu_demo_flag'] })).toEqual([
    'behavior:demo: bundle:absent:tengu_demo_flag is present in the target bundle',
  ])
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: ['bundle:no-name:"name:"'] })).toEqual([
    'behavior:demo: bundle:no-name:name: is present in the target bundle',
  ])
  expect(check({ id: 'behavior:demo', kind: 'behavior', evidence: ['bundle:no-name:"name:\\"demo\\""'] })).toEqual([])
})

test('refreshes a rotted env offset from its identifier', () => {
  const entry: StatusEntry = { id: 'env:CLAUDE_CODE_DEMO', kind: 'env', status: 'ported', evidence: ['bundle:0'] }
  const result = refreshEvidence([entry], {
    targetText: TARGET,
    scenariosDir: 'scripts/upgrade/scenarios',
    repoRoot: process.cwd(),
  })
  const offset = TARGET.indexOf('CLAUDE_CODE_DEMO')
  expect(result.entries[0].evidence).toEqual([`bundle:${offset}`])
  expect(result.updated).toEqual([{ id: 'env:CLAUDE_CODE_DEMO', from: 'bundle:0', to: `bundle:${offset}` }])
  expect(result.skipped).toEqual([])
})

test('leaves valid offsets untouched and reports unrecoverable ones', () => {
  const offset = TARGET.indexOf('CLAUDE_CODE_DEMO')
  const entries: StatusEntry[] = [
    { id: 'env:CLAUDE_CODE_DEMO', kind: 'env', status: 'ported', evidence: [`bundle:${offset}`] },
    { id: 'behavior:demo', kind: 'behavior', status: 'ported', evidence: [`bundle:${TARGET.indexOf('{')}`] },
    { id: 'str:gone', kind: 'str', status: 'ported', evidence: ['bundle:999999'] },
  ]
  const result = refreshEvidence(entries, {
    targetText: TARGET,
    scenariosDir: 'scripts/upgrade/scenarios',
    repoRoot: process.cwd(),
  })
  expect(result.updated).toEqual([])
  expect(result.skipped.map((item) => item.id)).toEqual(['behavior:demo', 'str:gone'])
  expect(result.entries[0].evidence).toEqual([`bundle:${offset}`])
})

test('resolves scenario and test evidence paths', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'case.json'), '{}')
  const errors = checkEvidence(
    [{ id: 'behavior:demo', kind: 'behavior', status: 'ported', evidence: ['scenario:case.json', 'test:nope.ts'] }],
    { targetText: TARGET, scenariosDir: dir, repoRoot: dir },
  )
  expect(errors).toEqual(['behavior:demo: test file ' + join(dir, 'nope.ts') + ' not found'])
})
