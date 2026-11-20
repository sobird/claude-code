import { expect, test } from 'bun:test'

import { renderMarkdown } from '../report'
import type { VerifyReport } from '../types'

const FIXTURE: VerifyReport = {
  ok: true,
  counts: {
    'already-present': 1,
    ported: 2,
    approximated: 0,
    'ignored-dependency': 0,
    'retained-internal': 0,
    unresolved: 0,
  },
  ledgerErrors: [],
  missingInSrc: ['cmd:missing'],
  unexpectedInSrc: [],
  unregistered: ['env:OLD'],
  unresolved: [],
  evidenceErrors: [],
  srcEvidenceErrors: [],
  uncoveredReleaseItems: [],
}

test('renderMarkdown includes the summary, counts, and findings sections', () => {
  const report = renderMarkdown(FIXTURE)
  expect(report).toContain('# Upgrade verification report')
  expect(report).toContain('OK: true')
  expect(report).toMatch(/\| ported\s+\| 2\s+\|/)
  expect(report).toMatch(/\| unresolved\s+\| 0\s+\|/)
  expect(report).toContain('## Missing in src')
  expect(report).toContain('- cmd:missing')
  expect(report).toContain('## Unregistered')
  expect(report).toContain('- env:OLD')
})

test('renderMarkdown pads the counts table header like oxfmt', () => {
  const tableLines = renderMarkdown(FIXTURE)
    .split('\n')
    .filter((line) => line.startsWith('|'))
  expect(tableLines[0]).toBe('| Status             | Count |')
  expect(tableLines[1]).toBe('| ------------------ | ----- |')
  expect(new Set(tableLines.map((line) => line.length)).size).toBe(1)
})
