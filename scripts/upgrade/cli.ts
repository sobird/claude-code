import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { alignBundles } from './align'
import { carveNativeBundle } from './carve'
import { type AnchorsResult, analyzeAnchors, type DiffResult, diffAround, diffSegment } from './diffbundle'
import { refreshEvidence } from './evidence'
import { extractCandidates } from './extract'
import { buildFeaturesReport, writeFeaturesReport } from './features'
import { GATE_COMMANDS, type GateName, runGates, writeGatesReport } from './gates'
import { scanBundle } from './inventory'
import { runProbe } from './probe'
import { fetchReleaseNotes, parseReleaseNotes, type ReleaseNotes } from './releaseNotes'
import { writeReport } from './report'
import { triageStrings, writeStringsReport } from './strings'
import { type TableDiff, diffTables, extractTable, isEmptyDiff, loadSrcTable } from './table'
import type { Inventory, StatusLedger } from './types'
import { readSources, verifyUpgrade } from './verify'

const USAGE = `Usage: bun scripts/upgrade/cli.ts <subcommand> [options]

Subcommands:
  carve     --binary <native-executable> --out <js>   (2.1.113+ native releases only)
  inventory --bundle <file> --out <json>
  align     --reference <bundle> [--map <map>] --target <bundle> [--prior-align <json>] --out <dir>
  extract   --align <align.json> --target <bundle> --keywords <a,b,c> --out <dir>
  gates     --ref <git-ref> --out <dir> [--gate typecheck,lint,test] [--fail-on-new]
  table     --bundle <file> --anchor <key> [--whole] [--baseline <json> | --src <path#export>] --out <json>
            [--fail-on-diff]
  strings   --reference-inventory <json> --target-inventory <json> --src <dir> [--release-notes <file>] --out <dir>
  features  --status <json> --reference-inventory <json> --target-inventory <json> --release-notes <json> --out <dir>
  releasenotes --version <tag> [--body-file <md>] [--repo <owner/name>] --out <json>
  refresh-evidence --target <bundle> --status <status.json> [--src <dir>] --out <json> [--in-place]
            [--fail-on-skipped]
  probe     --target <bundle> --scenario <file> --out <json>
  verify    --target <bundle> --reference <bundle> --src <dir> --status <status.json> --out <report dir>
            [--strict-evidence] [--scenarios <dir>] [--release-notes <json>]
  diffbundle --reference <bundle> --target <bundle> --out <json>
            (--segment --start <s> --end <e> | --around <anchor> --pad <n> | --anchors --band <lo:hi>)
            [--max-edits <n>] [--min-run <n>] [--min-len <n>] [--min-chg <n>] [--min-extra <n>]
`

type Values = Record<string, string | boolean | undefined>

function parseOptions(args: string[], options: Record<string, { type: 'string' | 'boolean' }>): Values {
  const { values } = parseArgs({ args, options, strict: true, allowPositionals: true })
  return values as Values
}

function requireValue(values: Values, name: string): string {
  const value = values[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing required --${name}`)
  return value
}

function optionalNumber(values: Values, name: string): number | undefined {
  const value = values[name]
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got ${JSON.stringify(value)}`)
  return parsed
}

function optionalBand(values: Values, name: string): [number, number] | undefined {
  const value = values[name]
  if (typeof value !== 'string' || value.length === 0) return undefined
  const [lo, hi] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    throw new Error(`--${name} must be <lo>:<hi>, got ${JSON.stringify(value)}`)
  return [lo, hi]
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

async function gatesCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    ref: { type: 'string' },
    out: { type: 'string' },
    gate: { type: 'string' },
    'fail-on-new': { type: 'boolean' },
  })
  const out = requireValue(values, 'out')
  const gates =
    typeof values.gate === 'string'
      ? values.gate
          .split(',')
          .map((gate) => gate.trim())
          .filter(Boolean)
      : undefined
  for (const gate of gates ?? []) {
    if (!(gate in GATE_COMMANDS)) throw new Error(`unknown gate "${gate}"`)
  }

  const result = runGates({
    ref: typeof values.ref === 'string' ? values.ref : 'HEAD',
    repoRoot: process.cwd(),
    gates: gates as GateName[] | undefined,
  })
  await writeGatesReport(result, out)
  const newFindings = result.gates.reduce((total, gate) => total + gate.added.length, 0)
  console.log(`wrote ${join(out, 'gates.json')} (${newFindings} new finding(s))`)
  return values['fail-on-new'] === true && newFindings > 0 ? 1 : 0
}

async function tableCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    bundle: { type: 'string' },
    anchor: { type: 'string' },
    baseline: { type: 'string' },
    src: { type: 'string' },
    out: { type: 'string' },
    whole: { type: 'boolean' },
    'fail-on-diff': { type: 'boolean' },
  })
  const out = requireValue(values, 'out')
  const bundle = requireValue(values, 'bundle')
  const anchor = requireValue(values, 'anchor')
  const whole = values.whole === true
  const table = extractTable(await readFile(bundle, 'utf8'), anchor, bundle, { whole })

  let diff: TableDiff | undefined
  if (typeof values.baseline === 'string') {
    const baseline = JSON.parse(await readFile(values.baseline, 'utf8')) as unknown
    diff = diffTables(baseline, table)
  } else if (typeof values.src === 'string') {
    diff = diffTables(await loadSrcTable(process.cwd(), values.src, { anchor, whole }), table)
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(diff ?? table, null, 2)}\n`, 'utf8')
  if (!diff) {
    console.log(`wrote ${out}`)
    return 0
  }
  console.log(`wrote ${out} (+${diff.added.length} / -${diff.removed.length} changes: ${diff.changed.length})`)
  return values['fail-on-diff'] === true && !isEmptyDiff(diff) ? 1 : 0
}

async function stringsCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    'reference-inventory': { type: 'string' },
    'target-inventory': { type: 'string' },
    src: { type: 'string' },
    'release-notes': { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const reference = JSON.parse(await readFile(requireValue(values, 'reference-inventory'), 'utf8')) as Inventory
  const target = JSON.parse(await readFile(requireValue(values, 'target-inventory'), 'utf8')) as Inventory
  const srcText = await readSources(requireValue(values, 'src'))
  const releaseNotesText =
    typeof values['release-notes'] === 'string' ? await readFile(values['release-notes'], 'utf8') : undefined

  const diff = triageStrings(reference, target, { srcText, releaseNotesText })
  await writeStringsReport(diff, out)
  console.log(
    `wrote ${join(out, 'strings.json')} (added ${diff.added.unclassified.length} unclassified, ` +
      `${diff.added.releaseNotes.length} in release notes, ${diff.added.inSrc.length} in src, ` +
      `${diff.added.noise.length} noise)`,
  )
  return 0
}

async function featuresCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    status: { type: 'string' },
    'reference-inventory': { type: 'string' },
    'target-inventory': { type: 'string' },
    'release-notes': { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const [referenceText, targetText, ledgerText, notesText] = await Promise.all([
    readFile(requireValue(values, 'reference-inventory'), 'utf8'),
    readFile(requireValue(values, 'target-inventory'), 'utf8'),
    readFile(requireValue(values, 'status'), 'utf8'),
    readFile(requireValue(values, 'release-notes'), 'utf8'),
  ])
  const report = buildFeaturesReport({
    reference: JSON.parse(referenceText) as Inventory,
    target: JSON.parse(targetText) as Inventory,
    ledger: JSON.parse(ledgerText) as StatusLedger,
    notes: JSON.parse(notesText) as ReleaseNotes,
  })
  await writeFeaturesReport(report, out)
  const counts = report.counts
  console.log(
    `wrote ${join(out, 'features.json')} (added ${counts.added}, retained ${counts.retained}, ` +
      `synced ${counts.synced}, releaseItems ${counts.releaseItems}, uncovered ${counts.uncovered})`,
  )
  return 0
}

async function releaseNotesCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    version: { type: 'string' },
    'body-file': { type: 'string' },
    repo: { type: 'string' },
    out: { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const version = requireValue(values, 'version')
  const body =
    typeof values['body-file'] === 'string'
      ? await readFile(values['body-file'], 'utf8')
      : fetchReleaseNotes(version, typeof values.repo === 'string' ? values.repo : undefined)
  const items = parseReleaseNotes(body)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify({ version, items }, null, 2)}\n`)
  console.log(`wrote ${out} (${items.length} item(s))`)
  return 0
}

async function refreshEvidenceCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    target: { type: 'string' },
    status: { type: 'string' },
    src: { type: 'string' },
    out: { type: 'string' },
    'in-place': { type: 'boolean' },
    'fail-on-skipped': { type: 'boolean' },
  })
  const out = requireValue(values, 'out')
  const statusPath = requireValue(values, 'status')
  const repoRoot = resolve(typeof values.src === 'string' ? values.src : process.cwd())
  const [ledgerText, targetText] = await Promise.all([
    readFile(statusPath, 'utf8'),
    readFile(requireValue(values, 'target'), 'utf8'),
  ])
  const ledger = JSON.parse(ledgerText) as StatusLedger
  const result = refreshEvidence(ledger.entries, {
    targetText,
    scenariosDir: resolve(repoRoot, 'scripts/upgrade/scenarios'),
    repoRoot,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify({ updated: result.updated, skipped: result.skipped }, null, 2)}\n`)
  if (values['in-place'] === true) {
    await writeFile(statusPath, `${JSON.stringify({ ...ledger, entries: result.entries }, null, 2)}\n`)
  }
  console.log(`wrote ${out} (updated ${result.updated.length}, skipped ${result.skipped.length})`)
  return values['fail-on-skipped'] === true && result.skipped.length > 0 ? 1 : 0
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
    'strict-evidence': { type: 'boolean' },
    scenarios: { type: 'string' },
    'release-notes': { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const report = await verifyUpgrade({
    targetPath: requireValue(values, 'target'),
    referencePath: requireValue(values, 'reference'),
    srcDir: requireValue(values, 'src'),
    statusPath: requireValue(values, 'status'),
    strictEvidence: values['strict-evidence'] === true,
    scenariosDir: typeof values.scenarios === 'string' ? values.scenarios : undefined,
    releaseNotesPath: typeof values['release-notes'] === 'string' ? values['release-notes'] : undefined,
  })
  await writeReport(report, out)
  console.log(`wrote ${join(out, 'report.json')} (ok=${report.ok})`)
  return report.ok ? 0 : 1
}

async function diffbundleCommand(args: string[]): Promise<number> {
  const values = parseOptions(args, {
    reference: { type: 'string' },
    target: { type: 'string' },
    out: { type: 'string' },
    segment: { type: 'boolean' },
    start: { type: 'string' },
    end: { type: 'string' },
    around: { type: 'string' },
    pad: { type: 'string' },
    anchors: { type: 'boolean' },
    band: { type: 'string' },
    'max-edits': { type: 'string' },
    'min-run': { type: 'string' },
    'min-len': { type: 'string' },
    'min-chg': { type: 'string' },
    'min-extra': { type: 'string' },
  })
  const out = requireValue(values, 'out')
  const reference = await readFile(requireValue(values, 'reference'), 'utf8')
  const target = await readFile(requireValue(values, 'target'), 'utf8')
  const maxEdits = optionalNumber(values, 'max-edits')
  const minRun = optionalNumber(values, 'min-run')

  let result: DiffResult | AnchorsResult
  let summary: string
  if (values.segment === true || typeof values.start === 'string' || typeof values.end === 'string') {
    const diff = diffSegment(reference, target, {
      startAnchor: requireValue(values, 'start'),
      endAnchor: requireValue(values, 'end'),
      maxEdits,
      minRun,
    })
    result = diff
    const s = diff.stats
    summary = `tokens ${s.tokensReference}/${s.tokensTarget}, eq ${s.eq}, ins ${s.ins}, del ${s.del}${diff.truncated ? ', truncated' : ''}`
  } else if (typeof values.around === 'string') {
    const diff = diffAround(reference, target, {
      anchor: values.around,
      pad: optionalNumber(values, 'pad') ?? 4000,
      maxEdits,
      minRun,
    })
    result = diff
    const s = diff.stats
    summary = `tokens ${s.tokensReference}/${s.tokensTarget}, eq ${s.eq}, ins ${s.ins}, del ${s.del}${diff.truncated ? ', truncated' : ''}`
  } else if (values.anchors === true) {
    const anchors = analyzeAnchors(reference, target, {
      band: optionalBand(values, 'band'),
      minLen: optionalNumber(values, 'min-len'),
      minChg: optionalNumber(values, 'min-chg'),
      minExtra: optionalNumber(values, 'min-extra'),
    })
    result = anchors
    summary = `${anchors.anchorCount} anchors, ${anchors.changePoints.length} change points, ${anchors.bigInsertions.length} big insertions`
  } else {
    throw new Error('diffbundle: choose --segment (--start/--end), --around <anchor>, or --anchors')
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`wrote ${out} (${summary})`)
  return 0
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
      case 'gates':
        return await gatesCommand(rest)
      case 'table':
        return await tableCommand(rest)
      case 'strings':
        return await stringsCommand(rest)
      case 'features':
        return await featuresCommand(rest)
      case 'releasenotes':
        return await releaseNotesCommand(rest)
      case 'refresh-evidence':
        return await refreshEvidenceCommand(rest)
      case 'probe':
        return await probeCommand(rest)
      case 'verify':
        return await verifyCommand(rest)
      case 'diffbundle':
        return await diffbundleCommand(rest)
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
