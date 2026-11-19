import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { ledgerEntryValue } from './ledger'
import { type LiteralRange, scanLiterals } from './stringScanner'
import type { StatusEntry } from './types'

export type EvidenceContext = {
  targetText: string
  scenariosDir: string
  repoRoot: string
}

export type EvidenceRefresh = {
  entries: StatusEntry[]
  updated: { id: string; from: string; to: string }[]
  skipped: { id: string; evidence: string; reason: string }[]
}

// Evidence offsets legitimately point either inside a literal (the quoted text
// / template / regex a behavior lives in) or at the start of an identifier
// (env names appear as code, not strings).
const IDENT_START = /[A-Za-z0-9_$]/

function insideLiteral(ranges: LiteralRange[], offset: number): boolean {
  for (const range of ranges) {
    if (offset < range.start) return false
    if (offset < range.end) return true
  }
  return false
}

// Validate that each recorded evidence pointer still resolves. `bundle:<offset>`
// offsets are decoded-character offsets produced by `indexOf` on the bundle, so
// they mark the first character of the evidence value — not necessarily a
// string literal (an env name appears as an identifier).
export function checkEvidence(entries: StatusEntry[], ctx: EvidenceContext): string[] {
  const needsRanges = entries.some((entry) => entry.evidence.some((value) => /^bundle:\d+$/.test(value)))
  const ranges = needsRanges ? scanLiterals(ctx.targetText) : []
  const errors: string[] = []
  for (const entry of entries) {
    const anchor = ledgerEntryValue(entry)
    for (const raw of entry.evidence) {
      const error = checkOne(entry, anchor, raw, ctx, ranges)
      if (error) errors.push(`${entry.id}: ${error}`)
    }
  }
  return errors
}

// Offsets rot when the upstream bundle shifts. We can only re-derive an offset
// when the entry carries its own search anchor (`env:`/`str:`/`flag:` ids), so
// validated pointers are left untouched and unrecoverable ones are reported
// rather than guessed. Rewriting only-on-failure keeps the operation idempotent.
export function refreshEvidence(entries: StatusEntry[], ctx: EvidenceContext): EvidenceRefresh {
  const needsRanges = entries.some((entry) => entry.evidence.some((value) => /^bundle:\d+$/.test(value)))
  const ranges = needsRanges ? scanLiterals(ctx.targetText) : []
  const updated: EvidenceRefresh['updated'] = []
  const skipped: EvidenceRefresh['skipped'] = []
  const next = entries.map((entry) => {
    const anchor = ledgerEntryValue(entry)
    const evidence = entry.evidence.map((raw) => {
      const offset = /^bundle:(\d+)$/.exec(raw)
      if (!offset) {
        const error = checkOne(entry, anchor, raw, ctx, ranges)
        if (error) skipped.push({ id: entry.id, evidence: raw, reason: error })
        return raw
      }
      const current = Number(offset[1])
      const error = checkOffset(anchor, current, ctx.targetText, ranges)
      if (!error) return raw
      const search =
        anchor && (anchor.prefix === 'env' || anchor.prefix === 'flag' || anchor.prefix === 'str') ? anchor.value : null
      const found = search === null ? -1 : ctx.targetText.indexOf(search)
      if (found === -1 || checkOffset(anchor, found, ctx.targetText, ranges)) {
        skipped.push({ id: entry.id, evidence: raw, reason: search === null ? error : `anchor "${search}" not found` })
        return raw
      }
      const replacement = `bundle:${found}`
      updated.push({ id: entry.id, from: raw, to: replacement })
      return replacement
    })
    return { ...entry, evidence }
  })
  return { entries: next, updated, skipped }
}

function checkOne(
  entry: StatusEntry,
  anchor: { prefix: string; value: string } | null,
  raw: string,
  ctx: EvidenceContext,
  ranges: LiteralRange[],
): string | null {
  if (raw.startsWith('bundle:absent:')) {
    const value = raw.slice('bundle:absent:'.length)
    return ctx.targetText.includes(value) ? `bundle:absent:${value} is present in the target bundle` : null
  }

  if (raw.startsWith('bundle:no-name:')) {
    const value = raw.slice('bundle:no-name:'.length).replace(/^"|"$/g, '')
    return ctx.targetText.includes(value) ? `bundle:no-name:${value} is present in the target bundle` : null
  }

  if (raw.startsWith('bundle:')) {
    const value = raw.slice('bundle:'.length)
    if (/^\d+$/.test(value)) return checkOffset(anchor, Number(value), ctx.targetText, ranges)
    return ctx.targetText.includes(value) ? null : `"${value}" not found in the target bundle`
  }

  if (raw.startsWith('scenario:')) {
    const name = raw.slice('scenario:'.length)
    const path = join(ctx.scenariosDir, name)
    return existsSync(path) ? null : `scenario file ${path} not found`
  }

  if (raw.startsWith('test:')) {
    const path = raw.slice('test:'.length)
    const full = isAbsolute(path) ? path : resolve(ctx.repoRoot, path)
    return existsSync(full) ? null : `test file ${full} not found`
  }

  return `unrecognized evidence "${raw}"`
}

function checkOffset(
  anchor: { prefix: string; value: string } | null,
  offset: number,
  text: string,
  ranges: LiteralRange[],
): string | null {
  if (offset >= text.length) return `bundle:${offset} is outside the target bundle`
  const char = text[offset]
  if (!insideLiteral(ranges, offset) && !IDENT_START.test(char)) {
    return `bundle:${offset} points at "${char}", not a literal or identifier`
  }
  // Env names are recorded at their first occurrence, so the offset must start
  // the identifier itself. Other kinds have no derivable anchor and only get
  // the weaker token-start check.
  if (anchor?.prefix === 'env' && !text.startsWith(anchor.value, offset)) {
    return `bundle:${offset} does not point at ${anchor.value}`
  }
  return null
}
