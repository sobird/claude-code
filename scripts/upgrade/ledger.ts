import type { Status, StatusEntry, StatusLedger } from './types'

export const STATUSES: Status[] = [
  'already-present',
  'ported',
  'approximated',
  'ignored-dependency',
  'retained-internal',
  'unresolved',
]

// id prefix -> the kind the entry must declare. `bundle-only:` stays paired
// with `behavior` because it records a behavior the bundle proves differently.
const PREFIX_KIND: Record<string, string> = {
  cmd: 'cmd',
  env: 'env',
  flag: 'flag',
  str: 'str',
  behavior: 'behavior',
  'bundle-only': 'behavior',
}

const EVIDENCE_RE = /^(bundle:(absent:|no-name:)?|scenario:|test:).+/
const ENV_ID_RE = /^env:[A-Za-z_][A-Za-z0-9_]*$/

export function ledgerEntryValue(entry: StatusEntry): { prefix: string; value: string } | null {
  const index = entry.id.indexOf(':')
  if (index === -1) return null
  return { prefix: entry.id.slice(0, index), value: entry.id.slice(index + 1) }
}

// Structural checks only: duplicates, unknown enums/prefixes, kind mismatches
// and malformed evidence. These are unambiguous authoring errors, so they
// always fail `verify` instead of being downgraded like evidence drift.
export function validateLedger(ledger: StatusLedger): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  for (const entry of ledger.entries) {
    if (seen.has(entry.id)) errors.push(`${entry.id}: duplicate id`)
    seen.add(entry.id)

    if (!STATUSES.includes(entry.status)) errors.push(`${entry.id}: unknown status "${entry.status}"`)

    const parsed = ledgerEntryValue(entry)
    if (!parsed || !(parsed.prefix in PREFIX_KIND)) {
      errors.push(`${entry.id}: unknown id prefix`)
    } else {
      const expected = PREFIX_KIND[parsed.prefix]
      if (entry.kind !== expected) errors.push(`${entry.id}: kind "${entry.kind}" should be "${expected}"`)
    }

    if (entry.id.startsWith('flag:') && !entry.id.startsWith('flag:--')) {
      errors.push(`${entry.id}: flag ids must start with "flag:--"`)
    }
    if (entry.id.startsWith('env:') && !ENV_ID_RE.test(entry.id)) {
      errors.push(`${entry.id}: malformed env id`)
    }

    for (const evidence of entry.evidence) {
      if (!EVIDENCE_RE.test(evidence)) errors.push(`${entry.id}: malformed evidence "${evidence}"`)
    }

    for (const item of entry.releaseItems ?? []) {
      if (!Number.isInteger(item) || item < 1) errors.push(`${entry.id}: invalid releaseItem ${item}`)
    }
  }

  return errors
}
