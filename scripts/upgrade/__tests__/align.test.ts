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
