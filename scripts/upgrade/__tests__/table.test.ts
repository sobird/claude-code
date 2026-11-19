import { expect, test } from 'bun:test'

import { diffTables, extractTable, isEmptyDiff, valueToJson } from '../table'

const BUNDLE = [
  'var x={',
  '"get-date":{safeFlags:["-Date","-Format"],additionalCommandIsDangerousCallback:FyK},',
  '"set-item":{safeFlags:["-Value"],count:3},',
  '};',
].join('')

test('extracts an anchored object literal without evaluating it', () => {
  expect(extractTable(BUNDLE, 'get-date')).toEqual({
    safeFlags: ['-Date', '-Format'],
    additionalCommandIsDangerousCallback: { $ident: true },
  })
})

test('extracts the whole table that contains the anchor', () => {
  const whole = extractTable(`var t={${BUNDLE.slice(7, -2)}};`, 'get-date', 'bundle.js', { whole: true })
  expect(Object.keys(whole as Record<string, unknown>).toSorted()).toEqual(['get-date', 'set-item'])
})

test('rejects non-literal syntax instead of evaluating it', () => {
  expect(() => extractTable('var x={anchor:{run:foo()}};', 'anchor')).toThrow('unsupported syntax')
})

test('reports a missing anchor', () => {
  expect(() => extractTable(BUNDLE, 'nope')).toThrow('no object literal anchored at "nope"')
})

test('diffs nested keys, arrays and identifier presence', () => {
  const baseline = { table: { safeFlags: ['-A', '-B'], cb: { $ident: true } } }
  const target = { table: { safeFlags: ['-A', '-C'], cb: { $ident: true } } }
  const diff = diffTables(baseline, target)
  expect(diff.added).toEqual([{ path: 'table.safeFlags[]', value: '-C' }])
  expect(diff.removed).toEqual([{ path: 'table.safeFlags[]', value: '-B' }])
  expect(diff.changed).toEqual([])
  expect(isEmptyDiff(diff)).toBe(false)
})

test('treats renamed callbacks as equal and reports primitive changes', () => {
  expect(isEmptyDiff(diffTables({ cb: { $ident: true } }, { cb: { $ident: true } }))).toBe(true)
  expect(diffTables({ n: 1 }, { n: 2 }).changed).toEqual([{ path: 'n', baseline: 1, target: 2 }])
})

test('maps minifier boolean/undefined literals', () => {
  const whole = extractTable('var t={a:{v:!0},b:{v:!1},c:{v:void 0}};', 'a', 'bundle.js', { whole: true })
  expect(whole).toEqual({ a: { v: true }, b: { v: false }, c: { v: { $undefined: true } } })
})

test('normalizes runtime values from src exports', () => {
  expect(valueToJson({ fn: () => 1, map: new Map([['k', ['v']]]), set: new Set(['x']) })).toEqual({
    fn: { $ident: true },
    map: { k: ['v'] },
    set: ['x'],
  })
})
