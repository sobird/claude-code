import { expect, test } from 'bun:test'

import { analyzeAnchors, diffAround, diffSegment, myersDiff, tokenize } from '../diffbundle'

test('tokenize collapses non-keyword identifiers to I but keeps keywords and literals', () => {
  const norms = tokenize('var foo=bar(1,"x")').map((token) => token.norm)
  expect(norms).toEqual(['var', 'I', '=', 'I', '(', '1', ',', '"x"', ')'])
})

test('tokenize is rename-invariant across minifier differences', () => {
  const a = tokenize('function f(a){return a+1}')
  const b = tokenize('function g(x){return x+1}')
  expect(a.map((t) => t.norm)).toEqual(b.map((t) => t.norm))
})

test('myersDiff reports identical sequences as all-equal', () => {
  const a = tokenize('a+b+c')
  const b = tokenize('x+y+z')
  const ops = myersDiff(a, b, 100)
  expect(ops).not.toBeNull()
  expect(ops?.every((op) => op.op === 'eq')).toBe(true)
})

test('myersDiff returns null past the edit budget', () => {
  const a = tokenize('x+y+z')
  const b = tokenize('x*z*w')
  expect(myersDiff(a, b, 1)).toBeNull()
  expect(myersDiff(a, b, 100)).not.toBeNull()
})

test('diffSegment sees rename-only edits as identical', () => {
  const reference = 'PRE foo=bar(1) MID'
  const target = 'PRE baz=qux(1) MID'
  const result = diffSegment(reference, target, { startAnchor: 'PRE', endAnchor: 'MID' })
  expect(result.scope.mode).toBe('segment')
  expect(result.stats.identical).toBe(true)
  expect(result.runs).toEqual([])
})

test('diffSegment surfaces a real logic change with verbatim text', () => {
  const reference = 'PRE foo=bar(1) MID'
  const target = 'PRE foo=bar(1,2) MID'
  const result = diffSegment(reference, target, { startAnchor: 'PRE', endAnchor: 'MID' })
  expect(result.stats.identical).toBe(false)
  const inserted = result.runs.find((run) => run.side === 'target')
  expect(inserted).toBeDefined()
  expect(inserted?.text).toContain('2')
})

test('diffSegment rejects a missing anchor', () => {
  expect(() => diffSegment('a', 'a', { startAnchor: 'nope', endAnchor: 'a' })).toThrow('start anchor')
})

test('diffAround diffs a window around one anchor', () => {
  const reference = 'padding foo=bar(1) tail'
  const target = 'padding foo=bar(1,2) tail'
  const result = diffAround(reference, target, { anchor: 'bar', pad: 8 })
  expect(result.scope.mode).toBe('around')
  expect(result.stats.identical).toBe(false)
})

test('analyzeAnchors flags a big insertion between shared literals', () => {
  const reference = 'x="UNIQUE_LITERAL_AAAA"mid"UNIQUE_LITERAL_BBBB"'
  const target = `x="UNIQUE_LITERAL_AAAA"mid${'Z'.repeat(400)}"UNIQUE_LITERAL_BBBB"`
  const result = analyzeAnchors(reference, target, { minExtra: 300 })
  expect(result.anchorCount).toBe(2)
  expect(result.bigInsertions.length).toBeGreaterThanOrEqual(1)
  expect(result.bigInsertions[0].extra).toContain('ZZZ')
  expect(result.changePoints.length).toBeGreaterThanOrEqual(2)
})
