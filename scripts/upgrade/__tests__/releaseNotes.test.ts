import { expect, test } from 'bun:test'

import { parseReleaseNotes, releaseCoverage } from '../releaseNotes'
import type { StatusEntry, StatusLedger } from '../types'

test('parses top-level bullets and keeps nested lines with their item', () => {
  const body = [
    '## What changed',
    '',
    '- First item',
    '  - nested detail',
    '* Second item',
    '  continuation line',
    '',
    '1. Third item',
    '  - nested under third',
  ].join('\n')
  expect(parseReleaseNotes(body)).toEqual([
    'First item - nested detail',
    'Second item continuation line',
    'Third item - nested under third',
  ])
})

function ledger(entries: Partial<StatusEntry>[]): StatusLedger {
  return {
    source: { reference: 'ref', target: 'tgt' },
    entries: entries.map((entry) => ({
      id: 'behavior:demo',
      kind: 'behavior',
      status: 'ported',
      evidence: [],
      ...entry,
    })),
  }
}

test('reports uncovered and out-of-range release items', () => {
  const coverage = releaseCoverage(ledger([{ releaseItems: [1, 3] }]), 2)
  expect(coverage.uncovered).toEqual([2])
  expect(coverage.unknown).toEqual(['behavior:demo: releaseItem 3 > 2 notes'])
})

test('treats every note as uncovered without releaseItems', () => {
  expect(releaseCoverage(ledger([]), 3).uncovered).toEqual([1, 2, 3])
})
