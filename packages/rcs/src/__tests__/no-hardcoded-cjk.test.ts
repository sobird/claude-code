import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { Glob } from 'bun'

const CJK = /[\u4e00-\u9fff]/
const ALLOWED = ['(offline)/~offline/page.tsx']
// Anchor the scan to this package so the guard also holds when `bun test` is run
// from the repo root (the workspace discovers this file there too).
const PACKAGE_ROOT = resolve(import.meta.dir, '../..')

describe('UI source is fully cataloged', () => {
  test('no CJK literals remain outside the bilingual offline page', async () => {
    const offenders: string[] = []
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan(PACKAGE_ROOT)) {
      if (path.includes('__tests__') || path.includes(ALLOWED[0] ?? '\u0000')) continue
      if (CJK.test(await Bun.file(resolve(PACKAGE_ROOT, path)).text())) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
