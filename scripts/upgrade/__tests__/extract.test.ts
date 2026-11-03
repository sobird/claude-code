import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { alignBundles } from '../align'
import { extractCandidates } from '../extract'
import type { AlignResult } from '../types'

const base = 'scripts/upgrade/__tests__/fixtures'
const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `extract-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

async function fixtureAlign(): Promise<string> {
  const align = await alignBundles({
    referencePath: `${base}/ref.js`,
    mapPath: `${base}/ref.js.map`,
    targetPath: `${base}/target.js`,
  })
  const alignPath = join(tempDir(), 'align.json')
  writeFileSync(alignPath, JSON.stringify(align))
  return alignPath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('writes a prettified candidate for a new node keyword hit', async () => {
  const alignPath = await fixtureAlign()
  const outDir = tempDir()
  const align = JSON.parse(readFileSync(alignPath, 'utf8')) as AlignResult

  // Align order is first, second, extra, gamma. `first` is matched and shares
  // the `alpha` literal with the reference; `gamma` is new and contains
  // `alpha2`.
  expect(align.nodes[0].classification).toBe('matched')
  expect(align.nodes[3].classification).toBe('new')

  const written = await extractCandidates({
    alignPath,
    targetPath: `${base}/target.js`,
    outDir,
    keywords: ['alpha'],
  })

  expect(written).toEqual([join(outDir, 'candidates', '3-functiondeclaration.ts')])
  expect(readdirSync(join(outDir, 'candidates'))).toEqual(['3-functiondeclaration.ts'])
  const text = readFileSync(written[0], 'utf8')
  expect(text).toContain('gamma')
  expect(text).toContain('alpha2')
  // A matched node that also matches the keyword (`first`, via `alpha`) must
  // not be extracted: candidates are limited to changed/new nodes.
  expect(written.some((path) => path.includes('0-functiondeclaration'))).toBe(false)
  expect(text).not.toContain('function first')
})

test('skips dependency nodes even when the keyword matches', async () => {
  const alignPath = await fixtureAlign()
  const outDir = tempDir()
  const align = JSON.parse(readFileSync(alignPath, 'utf8')) as AlignResult

  // `second` pairs as changed but is reclassified `ignored-dependency` by map
  // attribution.
  expect(align.nodes[1].classification).toBe('ignored-dependency')

  const written = await extractCandidates({
    alignPath,
    targetPath: `${base}/target.js`,
    outDir,
    keywords: ['depstr2'],
  })

  expect(written).toEqual([])
  expect(readdirSync(join(outDir, 'candidates'))).toEqual([])
})

test('skips nodes without a keyword hit and empty keyword lists', async () => {
  const alignPath = await fixtureAlign()
  const outDir = tempDir()

  const noHit = await extractCandidates({
    alignPath,
    targetPath: `${base}/target.js`,
    outDir,
    keywords: ['nope'],
  })
  expect(noHit).toEqual([])

  const empty = await extractCandidates({
    alignPath,
    targetPath: `${base}/target.js`,
    outDir,
    keywords: [],
  })
  expect(empty).toEqual([])
})
