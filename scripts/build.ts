import { rm } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import pkg from '../package.json'
import { banner, define, external, features, type BuildTarget } from './config'

const isDevelopment = process.env.NODE_ENV === 'development'
const outdir = 'dist'

// Clean output directory
await rm(outdir, { recursive: true, force: true })

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    ant: { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
})

const buildTraget: BuildTarget = values.ant ? 'ant' : 'external'

// Bundle
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'node',
  format: 'esm',
  minify: !isDevelopment,
  // compile: true,
  define: define(buildTraget),
  features,
  banner,
  external: [...external],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.info('Build success!', result.outputs)

// package.json
// oxlint-disable-next-line no-unused-vars
const { workspaces, scripts, devDependencies, files, 'lint-staged': _, trustedDependencies, ...cleanPkg } = pkg

await Bun.write(
  `${outdir}/package.json`,
  JSON.stringify(
    {
      ...cleanPkg,
      main: 'cli.js',
      bin: { sobird: 'cli.js' },
      dependencies: Object.fromEntries(external.map((dep) => [dep, pkg.dependencies[dep]])),
    },
    null,
    2,
  ),
)

await Promise.all([
  Bun.write(`${outdir}/README.md`, Bun.file('README.md')),
  Bun.write(`${outdir}/LICENSE`, Bun.file('LICENSE')),
])
