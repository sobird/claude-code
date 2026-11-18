import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { alignBundles } from './align'
import { carveNativeBundle } from './carve'
import { extractCandidates } from './extract'
import { scanBundle } from './inventory'
import { runProbe } from './probe'
import { writeReport } from './report'
import { verifyUpgrade } from './verify'

const USAGE = `Usage: bun scripts/upgrade/cli.ts <subcommand> [options]

Subcommands:
  carve     --binary <native-executable> --out <js>   (2.1.113+ native releases only)
  inventory --bundle <file> --out <json>
  align     --reference <bundle> [--map <map>] --target <bundle> [--prior-align <json>] --out <dir>
  extract   --align <align.json> --target <bundle> --keywords <a,b,c> --out <dir>
  probe     --target <bundle> --scenario <file> --out <json>
  verify    --target <bundle> [--reference <bundle>] --src <dir> --status <status.json> --out <report dir>
`

type Values = Record<string, string | boolean | undefined>

function parseOptions(args: string[], options: Record<string, { type: 'string' }>): Values {
  const { values } = parseArgs({ args, options, strict: true, allowPositionals: true })
  return values as Values
}

function requireValue(values: Values, name: string): string {
  const value = values[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing required --${name}`)
  return value
}

async function carveCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, { binary: { type: 'string' }, out: { type: 'string' } })
  const out = requireValue(values, 'out')
  const result = await carveNativeBundle({ binaryPath: requireValue(values, 'binary'), outPath: out })
  console.log(`wrote ${out} (version ${result.version}, ${result.chunks} chunk(s), ${result.bytes} bytes)`)
  return 0
}

async function inventoryCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, { bundle: { type: 'string' }, out: { type: 'string' } })
  const out = requireValue(values, 'out')
  const inventory = await scanBundle(requireValue(values, 'bundle'))
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(inventory, null, 2))
  console.log(`wrote ${out}`)
  return 0
}

async function alignCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    reference: { type: 'string' },
    map: { type: 'string' },
    target: { type: 'string' },
    'prior-align': { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const result = await alignBundles({
    referencePath: requireValue(values, 'reference'),
    mapPath: values.map as string | undefined,
    targetPath: requireValue(values, 'target'),
    priorAlignPath: values['prior-align'] as string | undefined,
  })
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'align.json'), JSON.stringify(result, null, 2))
  console.log(`wrote ${join(out, 'align.json')}`)
  return 0
}

async function extractCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    align: { type: 'string' },
    target: { type: 'string' },
    keywords: { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const rawKeywords = values.keywords
  const keywords =
    typeof rawKeywords === 'string'
      ? rawKeywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : []
  await mkdir(out, { recursive: true })
  const written = await extractCandidates({
    alignPath: requireValue(values, 'align'),
    targetPath: requireValue(values, 'target'),
    outDir: out,
    keywords,
  })
  console.log(`wrote ${written.length} candidate(s) to ${join(out, 'candidates')}`)
  return 0
}

async function probeCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    target: { type: 'string' },
    scenario: { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const trace = await runProbe({
    targetPath: requireValue(values, 'target'),
    scenarioPath: requireValue(values, 'scenario'),
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(trace, null, 2))
  console.log(`wrote ${out}`)
  return 0
}

async function verifyCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    target: { type: 'string' },
    reference: { type: 'string' },
    src: { type: 'string' },
    status: { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const report = await verifyUpgrade({
    targetPath: requireValue(values, 'target'),
    referencePath: typeof values.reference === 'string' ? values.reference : 'cli.js',
    srcDir: requireValue(values, 'src'),
    statusPath: requireValue(values, 'status'),
  })
  await writeReport(report, out)
  console.log(`wrote ${join(out, 'report.json')} (ok=${report.ok})`)
  return report.ok ? 0 : 1
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }

  const [subcommand, ...rest] = argv
  try {
    switch (subcommand) {
      case 'carve':
        return await carveCommand(rest)
      case 'inventory':
        return await inventoryCommand(rest)
      case 'align':
        return await alignCommand(rest)
      case 'extract':
        return await extractCommand(rest)
      case 'probe':
        return await probeCommand(rest)
      case 'verify':
        return await verifyCommand(rest)
      default:
        process.stderr.write(USAGE)
        return 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`error: ${message}\n`)
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
