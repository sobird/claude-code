import { expect, test } from 'bun:test'

import { diffMultiset, normalizeGateOutput, renderGatesMarkdown } from '../gates'

test('normalizes positions, roots and ANSI escapes', () => {
  const raw = '\u001b[31msrc/a.ts(12,4): error\u001b[0m\n/private/tmp/wt/src/b.ts(1,2): warn\n'
  expect(normalizeGateOutput(raw, ['/private/tmp/wt'])).toEqual(['src/a.ts(L,C): error', '<ROOT>/src/b.ts(L,C): warn'])
})

test('longest root wins when roots nest', () => {
  const raw = '/repo/worktree/src/a.ts: x'
  expect(normalizeGateOutput(raw, ['/repo', '/repo/worktree'])).toEqual(['<ROOT>/src/a.ts: x'])
})

test('keeps only the typecheck file + code, dropping unstable messages', () => {
  const raw = 'src/a.ts(1,2): error TS1: boom\n    elaboration here\nsrc/b.ts(9,4): error TS2: other\n'
  expect(normalizeGateOutput(raw, [], 'typecheck')).toEqual(['src/a.ts(L,C): error TS1', 'src/b.ts(L,C): error TS2'])
})

test('normalizes module specifiers and line references', () => {
  const raw = 'x: import("/tmp/a/b.ts").T is not T2; resolved on line 1286\nFinished in 6.7s on 10 files\n'
  expect(normalizeGateOutput(raw, [])).toEqual([
    'x: import("<MODULE>").T is not T2; resolved on line L',
    'Finished in T on N files',
  ])
})

test('sorts exhaustive-deps names so iteration order does not flap', () => {
  const raw = "! react-hooks(exhaustive-deps): React Hook useCallback has missing dependencies: 'track', and 'add'\n"
  expect(normalizeGateOutput(raw, [], 'lint')).toEqual([
    "! react-hooks(exhaustive-deps): React Hook useCallback has missing dependencies: 'add', 'track'",
  ])
})

test('keeps only failed test names for the test gate', () => {
  const raw = ' 27 fail\n(fail) suite > case a\nsome stack\n 961 pass\n'
  expect(normalizeGateOutput(raw, [], 'test')).toEqual(['(fail) suite > case a'])
})

test('drops lint code frames but keeps headers and messages', () => {
  const raw = '  ! eslint(rule): bad\n    ,-[src/a.ts:4:2]\n 3 | code\n   :  ^\n    `----\n  help: fix it\n'
  expect(normalizeGateOutput(raw, [], 'lint')).toEqual(['! eslint(rule): bad', ',-[src/a.ts:L:C]', 'help: fix it'])
})

test('multiset diff keeps moved lines equal and counts repeats', () => {
  const diff = diffMultiset(['a', 'b', 'b'], ['b', 'a', 'c'])
  expect(diff.added).toEqual(['c'])
  expect(diff.removed).toEqual(['b'])
})

test('renders a no-findings section', () => {
  const md = renderGatesMarkdown({
    ref: 'HEAD',
    gates: [{ gate: 'lint', baselineExit: 1, currentExit: 1, added: [], removed: [] }],
  })
  expect(md).toContain('## lint')
  expect(md).toContain('No new findings.')
})
