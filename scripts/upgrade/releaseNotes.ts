import { spawnSync } from 'node:child_process'

import type { StatusLedger } from './types'

export type ReleaseNotes = { version: string; items: string[] }

// Split a release body into its top-level list items. Nested bullets (indented)
// stay with the item they belong to, as do indented continuation lines.
export function parseReleaseNotes(body: string): string[] {
  const items: string[] = []
  let current: string | null = null
  let started = false

  for (const line of body.split(/\r?\n/)) {
    const match = !/^\s/.test(line) ? /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line) : null
    if (match) {
      if (current !== null) items.push(current.trim())
      current = match[1]
      started = true
      continue
    }
    if (started && current !== null && /^\s+\S/.test(line)) {
      current += ` ${line.trim()}`
    }
  }

  if (current !== null) items.push(current.trim())
  return items
}

// Upstream releases live in the vendor repo; `gh` otherwise defaults to the
// fork this pipeline runs inside, where the tag does not exist.
export const UPSTREAM_REPO = 'anthropics/claude-code'

export function fetchReleaseNotes(tag: string, repo = UPSTREAM_REPO): string {
  const result = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'body', '--jq', '.body'], {
    encoding: 'utf8',
  })
  if (result.error) throw new Error(`failed to run gh: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`gh release view ${tag} failed: ${result.stderr.trim()}`)
  return result.stdout
}

// `releaseItems` on ledger entries is 1-based and mirrors the order of the
// upstream release notes, so coverage is a simple set difference.
export function releaseCoverage(ledger: StatusLedger, itemCount: number): { uncovered: number[]; unknown: string[] } {
  const covered = new Set<number>()
  const unknown: string[] = []
  for (const entry of ledger.entries) {
    for (const item of entry.releaseItems ?? []) {
      if (item > itemCount) unknown.push(`${entry.id}: releaseItem ${item} > ${itemCount} notes`)
      else covered.add(item)
    }
  }
  const uncovered: number[] = []
  for (let item = 1; item <= itemCount; item++) if (!covered.has(item)) uncovered.push(item)
  return { uncovered, unknown }
}
