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

const EXPECTED = `# Upgrade verification report

OK: true

| Status             | Count |
| ------------------ | ----- |
| already-present    | 1     |
| ported             | 2     |
| approximated       | 0     |
| ignored-dependency | 0     |
| retained-internal  | 0     |
| unresolved         | 0     |

## Missing in src

- cmd:missing

## Unregistered

- env:OLD
`

test('renderMarkdown pads tables to stable column widths', () => {
  expect(renderMarkdown(FIXTURE)).toBe(EXPECTED)
})

test('renderMarkdown pads the counts table header like oxfmt', () => {
  const tableLines = renderMarkdown(FIXTURE)
    .split('\n')
    .filter((line) => line.startsWith('|'))
  expect(tableLines[0]).toBe('| Status             | Count |')
  expect(tableLines[1]).toBe('| ------------------ | ----- |')
  expect(new Set(tableLines.map((line) => line.length)).size).toBe(1)
})
