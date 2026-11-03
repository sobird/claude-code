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

  const srcCommands = new Set([...srcText.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]))
  const srcFlags = new Set([...srcText.matchAll(/['"](--[a-z0-9-]+)['"]/g)].map((match) => match[1]))

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
  for (const name of targetEnv) if (!srcText.includes(name)) group1(`env:${name}`)
  for (const name of referenceEnv) {
    if (!targetEnv.has(name) && srcText.includes(name)) group2(`env:${name}`)
  }

  for (const entry of ledger.entries) {
    if (entry.status === 'unresolved') {
      unresolved.push(entry.id)
      continue
    }
    const isFlag = entry.id.startsWith('flag:')
    const isStr = entry.id.startsWith('str:')
    if (!isFlag && !isStr) continue
    const value = entry.id.slice(isFlag ? 5 : 4)
    const inSrc = isFlag ? srcFlags.has(value) : srcText.includes(value)
    if (entry.status === 'ignored-dependency') {
      if (inSrc) unresolved.push(entry.id)
    } else if (!inSrc) {
      unresolved.push(entry.id)
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
