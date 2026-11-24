import { resolve } from 'node:path'

/** 构建 dsh 可直接加载的 ESM；core 一并内联，产物零运行时依赖。 */
const root = resolve(import.meta.dir, '..')
const outfile = resolve(root, 'lib/index.js')

const result = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts')],
  outdir: resolve(root, 'lib'),
  target: 'node',
  format: 'esm',
  // 发布产物压缩：与仓库根 CLI 的构建一致。ESM 导出名不受影响。
  minify: true,
})

if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}

const output = await Bun.file(outfile).text()
if (/from\s+['"]@(sobird|deepseek-ai)\//.test(output)) {
  console.error('build: lib/index.js still imports workspace or dsh packages')
  process.exit(1)
}

console.log(`build: ${outfile}`)
