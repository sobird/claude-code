import { rm } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { BuildTarget } from './config'
import { banner, define, external, features } from './config'

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

const buildTraget: BuildTarget = Boolean(values.ant) ? 'ant' : 'external'

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
  external,
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// eslint-disable-next-line no-console
console.info('Build success!', result.outputs)
