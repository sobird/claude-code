/**
 * String triage between two inventories.
 *
 * A version bump easily adds a few hundred string literals, most of which are
 * packaged-dependency noise or upstream UI wording that this repo has no path
 * for. Bucketing them (already in src / named in the release notes / obvious
 * noise / unclassified) shrinks the manual review to the last bucket.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Inventory } from './types'

export type StringBuckets = {
  inSrc: string[]
  releaseNotes: string[]
  noise: string[]
  unclassified: string[]
}

export type StringsDiff = { added: StringBuckets; removed: StringBuckets }

export function diffInventoryStrings(reference: Inventory, target: Inventory): { added: string[]; removed: string[] } {
  const referenceStrings = new Set(reference.strings)
  const targetStrings = new Set(target.strings)
  return {
    added: target.strings.filter((value) => !referenceStrings.has(value)),
    removed: reference.strings.filter((value) => !targetStrings.has(value)),
  }
}

const NOISE_PATTERNS = [/^[\d\s.,:%+\-/()]+$/, /^-webkit-|^@media\b|var\(--|^rgba?\(/i, /^#[0-9a-f]{3,8}$/i]

function isNoise(value: string): boolean {
  return value.trim().length < 8 || NOISE_PATTERNS.some((pattern) => pattern.test(value))
}

function releaseTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9_-]{4,}/g) ?? [])]
}

// Prompt strings often carry template leading/trailing whitespace that the
// source lacks; fall back to the trimmed body, then to its first substantial
// line (multi-line prompts are ported as markdown, not one literal).
function matchesSrc(value: string, srcText: string): boolean {
  if (value.length > 0 && srcText.includes(value)) return true
  const trimmed = value.trim()
  if (trimmed.length > 0 && srcText.includes(trimmed)) return true
  const firstLine = trimmed.split('\n').find((line) => line.trim().length >= 12)
  return firstLine !== undefined && srcText.includes(firstLine.trim())
}

export function classifyStrings(values: string[], ctx: { srcText: string; releaseNotesText?: string }): StringBuckets {
  const tokens = ctx.releaseNotesText ? releaseTokens(ctx.releaseNotesText) : []
  const buckets: StringBuckets = { inSrc: [], releaseNotes: [], noise: [], unclassified: [] }

  for (const value of values) {
    const lower = value.toLowerCase()
    if (matchesSrc(value, ctx.srcText)) buckets.inSrc.push(value)
    else if (tokens.some((token) => lower.includes(token))) buckets.releaseNotes.push(value)
    else if (isNoise(value)) buckets.noise.push(value)
    else buckets.unclassified.push(value)
  }

  for (const values of Object.values(buckets)) values.sort()
  return buckets
}

export function triageStrings(
  reference: Inventory,
  target: Inventory,
  ctx: { srcText: string; releaseNotesText?: string },
): StringsDiff {
  const { added, removed } = diffInventoryStrings(reference, target)
  return {
    added: classifyStrings(added, ctx),
    removed: classifyStrings(removed, ctx),
  }
}

function renderBucket(title: string, values: string[]): string[] {
  const lines = [`### ${title} (${values.length})`, '']
  if (values.length === 0) lines.push('_none_', '')
  for (const value of values) lines.push(`- \`${value.replaceAll('`', '\\`')}\``)
  if (values.length > 0) lines.push('')
  return lines
}

export function renderStringsMarkdown(diff: StringsDiff): string {
  const lines = ['# String triage', '', '## Added', '']
  for (const [title, key] of [
    ['Unclassified', 'unclassified'],
    ['Named in release notes', 'releaseNotes'],
    ['Already in src', 'inSrc'],
    ['Likely noise', 'noise'],
  ] as const) {
    lines.push(...renderBucket(title, diff.added[key]))
  }
  lines.push('## Removed', '')
  for (const [title, key] of [
    ['Unclassified', 'unclassified'],
    ['Already in src', 'inSrc'],
    ['Likely noise', 'noise'],
  ] as const) {
    lines.push(...renderBucket(title, diff.removed[key]))
  }
  return `${lines.join('\n')}\n`
}

export async function writeStringsReport(diff: StringsDiff, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'strings.json'), `${JSON.stringify(diff, null, 2)}\n`, 'utf8')
  await writeFile(join(outDir, 'strings.md'), renderStringsMarkdown(diff), 'utf8')
}
