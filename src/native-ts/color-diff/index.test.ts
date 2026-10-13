import { describe, it, expect, beforeAll } from 'bun:test'

import { ColorFile } from '.'

beforeAll(() => {
  process.env.COLORTERM = 'truecolor'
})

describe('语法识别与着色', () => {
  it('应该能识别关键字并涂上 青蓝色', () => {
    const code = 'const x = 1;'
    const cf = new ColorFile(code, 'test.ts')
    const lines = cf.render('monokai-dark', 80, false)

    // Monokai 关键字颜色: rgb(249, 38, 114) -> \u001B[38;2;102;217;239m
    expect(lines![0]).toContain('\u001B[38;2;102;217;239mconst')
  })

  it('应该能识别字符串并涂上 淡橄榄黄', () => {
    const code = 'console.log("hello")'
    const cf = new ColorFile(code, 'test.ts')
    const lines = cf.render('monokai-dark', 80, false)

    // 字符串颜色: rgb(215, 215, 135) -> \u001B[38;2;230;219;116m
    expect(lines![0]).toContain('\u001B[38;2;230;219;116m"hello"')
  })
})

describe('布局与行号', () => {
  it('多行代码应正确分配行号并右对齐', () => {
    const code = 'line1\nline2\nline3'
    const cf = new ColorFile(code, 'test.txt')
    const lines = cf.render('dark', 80, false)

    expect(lines).toHaveLength(3)
    // 验证行号前缀格式 (带 Dim 效果)
    expect(lines![0]).toContain('\x1b[2m 1 \x1b[22m')
    expect(lines![2]).toContain('\x1b[2m 3 \x1b[22m')
  })

  it('当代码超过宽度时应强制换行且不丢失高亮', () => {
    const longLine = 'const longVar = ' + "'A'".repeat(50)
    const width = 30
    const cf = new ColorFile(longLine, 'test.ts')
    const lines = cf.render('dark', width, false)

    // 验证是否发生了折行（输出行数 > 1）
    expect(lines!.length).toBeGreaterThan(1)
    // 验证第二行（折行部分）是否以空格对齐行号位置
    expect(lines![1]).toStartWith('\x1b[0m\x1b[38;')
  })
})

describe('降级与环境适配', () => {
  it('当 COLORTERM 非 truecolor 时，应输出 256 色编码', () => {
    // 临时修改环境
    const original = process.env.COLORTERM
    process.env.COLORTERM = ''

    const cf = new ColorFile('const a = 1', 'test.ts')
    const lines = cf.render('dark', 80, false)

    // 验证是否包含 \x1b[38;5;... 格式
    expect(lines![0]).toContain('\x1b[38;5;')

    process.env.COLORTERM = original
  })
})

describe('鲁棒性 (Robustness)', () => {
  it('处理包含特殊字符和 Emoji 的字符串不应对齐出错', () => {
    const code = 'const s = "🚀 Rocket";'
    const cf = new ColorFile(code, 'test.ts')
    const lines = cf.render('dark', 80, false)

    // 验证内容是否完整
    expect(lines![0]).toContain('🚀 Rocket')
  })

  it('空文件输入不应崩溃', () => {
    const cf = new ColorFile('', 'empty.ts')
    const lines = cf.render('dark', 80, false)
    expect(lines).toBeArray()
  })
})

describe('样式叠加测试', () => {
  it('开启 dim 模式后，每行应包含变暗转义码', () => {
    const cf = new ColorFile('const a = 1', 'test.ts')
    const lines = cf.render('dark', 80, true) // 开启 dim

    // \x1b[2m 是 DIM 代码
    expect(lines![0]).toContain('\x1b[2m')
    // 结尾必须有 RESET 否则会污染后续终端输出
    expect(lines![0]).toEndWith('\x1b[0m')
  })
})

describe('性能测试', () => {
  it('大规模文件渲染不应超过 200ms', () => {
    const bigCode = "console.log('test');\n".repeat(1000) // 1000行
    const cf = new ColorFile(bigCode, 'perf.ts')

    const start = performance.now()
    cf.render('dark', 120, false)
    const end = performance.now()

    // console.log(`渲染 1000 行耗时: ${end - start}ms`);
    expect(end - start).toBeLessThan(200)
  })
})

it('当文件后缀缺失时，应能通过 Shebang 识别语言', () => {
  const code = '#!/usr/bin/node\nconsole.log(1)'
  const cf = new ColorFile(code, 'my-script') // 没有后缀
  const lines = cf.render('dark', 80, false)

  // 如果识别成功，console 应该是内置对象颜色，1 应该是常量颜色
  expect(lines![1]).toContain('\x1b[38;2;190;132;255m1')
})

it('切换主题名称应改变颜色输出', () => {
  const code = 'function test() {}'
  const darkLines = new ColorFile(code, 'a.ts').render('dark', 80, false)
  const lightLines = new ColorFile(code, 'a.ts').render('light', 80, false)

  // 黑色主题 function 默认是粉色 (249, 38, 114)
  // 白色主题 function 默认是紫色 (167, 29, 93)
  expect(darkLines![0]).not.toEqual(lightLines![0])
})
