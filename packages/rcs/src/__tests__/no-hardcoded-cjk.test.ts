import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { Glob } from 'bun'

const CJK = /[\u4e00-\u9fff]/
// 离线页刻意用中英双语呈现文案。`components/demo` 是独立于产品面的 mock 数据
// 设计研究（见 `src/app/(demo)`）：它没有 locale 路由，等交互模型并入真实外壳后
// 会被删除，因此中文文案直接内联，而不走文案目录。
const ALLOWED = ['(offline)/~offline/page.tsx', '(demo)/', 'components/demo/']
// 把扫描锚定到本包，这样即使从仓库根目录跑 `bun test`（workspace 也会发现
// 这个文件），守卫依然生效。
const PACKAGE_ROOT = resolve(import.meta.dir, '../..')

/**
 * 去掉 `//` 行注释和块注释，但完整保留字符串与模板字面量。
 * 守卫只关心用户可见的硬编码文案；注释里写中文是允许的。
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
          out += c + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += c
        i++
        if (c === quote) break
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

describe('UI source is fully cataloged', () => {
  test('no CJK literals remain outside the bilingual offline page', async () => {
    const offenders: string[] = []
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan(PACKAGE_ROOT)) {
      if (path.includes('__tests__') || ALLOWED.some((entry) => path.includes(entry))) continue
      const text = stripComments(await Bun.file(resolve(PACKAGE_ROOT, path)).text())
      if (CJK.test(text)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
