import { afterEach, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { alignBundles } from '../align'

const base = 'scripts/upgrade/__tests__/fixtures'
const tempFiles: string[] = []

function writeTemp(first: unknown): string {
  const path = join(tmpdir(), `align-prior-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(path, JSON.stringify(first))
  tempFiles.push(path)
  return path
}

function writeTempSource(source: string): string {
  const path = join(tmpdir(), `align-src-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`)
  writeFileSync(path, source)
  tempFiles.push(path)
  return path
}

afterEach(() => {
  for (const path of tempFiles.splice(0)) rmSync(path, { force: true })
})

test('matches with map and attributes original file', async () => {
  const r = await alignBundles({
    referencePath: `${base}/ref.js`,
    mapPath: `${base}/ref.js.map`,
    targetPath: `${base}/target.js`,
  })
  expect(r.source.map).toBe(true)
  const matched = r.nodes.filter((n) => n.classification === 'matched' || n.classification === 'changed')
  expect(matched.some((n) => n.source?.file.endsWith('src/a.ts'))).toBe(true)
  expect(r.nodes.some((n) => n.classification === 'ignored-dependency')).toBe(true)
  expect(r.nodes.some((n) => n.classification === 'new')).toBe(true)
})

test('pairs changed functions by literal overlap, not source order', async () => {
  const referenceSource = [
    "function keep(x){if(x){return 'alpha-marker'}return 'beta-marker'}",
    "function other(y){return 'gamma-marker'}",
  ].join('\n')
  const targetSource = [
    "function other2(y){const z=y;return 'gamma-marker'}",
    "function keep2(x){while(x){x='alpha-marker'}return 'beta-marker'}",
  ].join('\n')
  const referencePath = writeTempSource(referenceSource)
  const targetPath = writeTempSource(targetSource)

  const r = await alignBundles({ referencePath, targetPath })
  const byTargetStart = new Map(r.nodes.map((node) => [node.target.start, node]))

  const other2 = byTargetStart.get(targetSource.indexOf('function other2'))
  const keep2 = byTargetStart.get(targetSource.indexOf('function keep2'))
  // `other2` shares a literal with `other`; first-same-kind would have paired
  // it with `keep` instead.
  expect(other2?.reference?.start).toBe(referenceSource.indexOf('function other'))
  expect(keep2?.reference?.start).toBe(referenceSource.indexOf('function keep'))
})

test('without map inherits attribution from prior align', async () => {
  const first = await alignBundles({
    referencePath: `${base}/ref.js`,
    mapPath: `${base}/ref.js.map`,
    targetPath: `${base}/target.js`,
  })
  const r = await alignBundles({
    referencePath: `${base}/target.js`,
    targetPath: `${base}/target.js`,
    priorAlignPath: writeTemp(first),
  })
  expect(r.nodes.every((n) => n.confidence !== 'high')).toBe(true)
  expect(r.nodes.some((n) => n.confidence === 'medium' && n.source?.file.endsWith('src/a.ts'))).toBe(true)
  expect(r.nodes.some((n) => n.confidence === 'low')).toBe(true)
})
