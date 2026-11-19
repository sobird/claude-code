import { expect, test } from 'bun:test'

import { validateLedger } from '../ledger'
import type { StatusEntry, StatusLedger } from '../types'

function ledger(entries: StatusEntry[]): StatusLedger {
  return { source: { reference: 'ref', target: 'tgt' }, entries }
}

function entry(overrides: Partial<StatusEntry> = {}): StatusEntry {
  return { id: 'cmd:demo', kind: 'cmd', status: 'ported', evidence: [], ...overrides }
}

test('accepts a structurally valid ledger', () => {
  expect(validateLedger(ledger([entry()]))).toEqual([])
})

test('rejects duplicate ids', () => {
  expect(validateLedger(ledger([entry(), entry()]))).toContain('cmd:demo: duplicate id')
})

test('rejects kind/prefix mismatches and unknown prefixes', () => {
  const errors = validateLedger(ledger([entry({ kind: 'env' }), entry({ id: 'wat:x', kind: 'x' })]))
  expect(errors).toContain('cmd:demo: kind "env" should be "cmd"')
  expect(errors).toContain('wat:x: unknown id prefix')
})

test('rejects malformed evidence and flag ids', () => {
  const errors = validateLedger(
    ledger([
      entry({ evidence: ['notes.txt'] }),
      entry({ id: 'flag:old', kind: 'flag', evidence: [] }),
      entry({ id: 'flag:--ok', kind: 'flag', evidence: ['bundle:absent:--ok'] }),
    ]),
  )
  expect(errors).toContain('cmd:demo: malformed evidence "notes.txt"')
  expect(errors).toContain('flag:old: flag ids must start with "flag:--"')
  expect(errors).not.toContain('flag:--ok: flag ids must start with "flag:--"')
})

test('rejects non-positive release items', () => {
  const errors = validateLedger(ledger([entry({ releaseItems: [0, 1.5] })]))
  expect(errors).toContain('cmd:demo: invalid releaseItem 0')
  expect(errors).toContain('cmd:demo: invalid releaseItem 1.5')
})
