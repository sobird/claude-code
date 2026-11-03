import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { scanBundle } from './inventory'
import type { Inventory, Status, StatusLedger, VerifyReport } from './types'

export type VerifyOptions = {
  targetPath: string
  referencePath: string
  srcDir: string
  statusPath: string
}

const STATUSES: Status[] = [
  'already-present',
  'ported',
  'approximated',
  'ignored-dependency',
  'retained-internal',
  'unresolved',
]

const GROUP1_OK = new Set<Status>(['ported', 'approximated'])
const GROUP2_OK = new Set<Status>(['already-present', 'retained-internal'])

const uniqSorted = (values: Iterable<string>): string[] => [...new Set(values)].toSorted()

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Match `value` only when it is not embedded in a longer identifier-like token,
// so e.g. CLAUDE_CODE_FOO does not match CLAUDE_CODE_FOOBAR.
const hasToken = (text: string, value: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`).test(text)

async function readSources(dir: string): Promise<string> {
  const parts: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        parts.push(await readFile(full, 'utf8'))
      }
    }
  }
  await walk(dir)
  return parts.join('\n')
}

function commandNames(inv: Inventory): Set<string> {
  return new Set(inv.commands.map((command) => command.name))
}

export async function verifyUpgrade(opts: VerifyOptions): Promise<VerifyReport> {
  const [target, reference, srcText, ledgerText] = await Promise.all([
    scanBundle(opts.targetPath),
    scanBundle(opts.referencePath),
    readSources(opts.srcDir),
    readFile(opts.statusPath, 'utf8'),
  ])
  const ledger = JSON.parse(ledgerText) as StatusLedger
  const byId = new Map(ledger.entries.map((entry) => [entry.id, entry]))

  const srcCommands = new Set([...srcText.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))

  const missingInSrc: string[] = []
  const unexpectedInSrc: string[] = []
  const unregistered: string[] = []
  const unresolved: string[] = []

  const group1 = (id: string): void => {
    const entry = byId.get(id)
    if (!entry) unregistered.push(id)
    else if (!GROUP1_OK.has(entry.status)) missingInSrc.push(id)
  }
  const group2 = (id: string): void => {
    const entry = byId.get(id)
    if (!entry) unregistered.push(id)
    else if (!GROUP2_OK.has(entry.status)) unexpectedInSrc.push(id)
  }

  const targetCommands = commandNames(target)
  const referenceCommands = commandNames(reference)
  for (const name of targetCommands) if (!srcCommands.has(name)) group1(`cmd:${name}`)
  for (const name of referenceCommands) {
    if (!targetCommands.has(name) && srcCommands.has(name)) group2(`cmd:${name}`)
  }

  const targetEnv = new Set(target.envVars)
  const referenceEnv = new Set(reference.envVars)
  for (const name of targetEnv) if (!hasToken(srcText, name)) group1(`env:${name}`)
  for (const name of referenceEnv) {
    if (!targetEnv.has(name) && hasToken(srcText, name)) group2(`env:${name}`)
  }

  const targetFlags = new Set(target.cliFlags)
  const referenceFlags = new Set(reference.cliFlags)
  const targetStrings = new Set(target.strings)
  const referenceStrings = new Set(reference.strings)

  for (const entry of ledger.entries) {
    if (entry.status === 'unresolved') {
      unresolved.push(entry.id)
      continue
    }
    const isFlag = entry.id.startsWith('flag:')
    const isStr = entry.id.startsWith('str:')
    if (!isFlag && !isStr) continue
    // ignored-dependency flag/string entries are advisory only, never fail.
    if (entry.status === 'ignored-dependency') continue
    // R13: classify ledgered flags/strings purely by bundle membership.
    // src presence may be cross-checked but must never change the classification.
    const value = entry.id.slice(isFlag ? 5 : 4)
    const targetHas = (isFlag ? targetFlags : targetStrings).has(value)
    const referenceHas = (isFlag ? referenceFlags : referenceStrings).has(value)
    if (targetHas && !referenceHas) {
      if (!GROUP1_OK.has(entry.status)) missingInSrc.push(entry.id)
    } else if (!targetHas && referenceHas) {
      if (!GROUP2_OK.has(entry.status)) unexpectedInSrc.push(entry.id)
    }
  }

  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>
  for (const entry of ledger.entries) counts[entry.status] += 1

  const report: VerifyReport = {
    ok: false,
    counts,
    missingInSrc: uniqSorted(missingInSrc),
    unexpectedInSrc: uniqSorted(unexpectedInSrc),
    unregistered: uniqSorted(unregistered),
    unresolved: uniqSorted(unresolved),
  }
  report.ok =
    report.missingInSrc.length +
      report.unexpectedInSrc.length +
      report.unregistered.length +
      report.unresolved.length ===
    0
  return report
}
