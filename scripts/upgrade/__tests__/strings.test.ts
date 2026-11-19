import { expect, test } from 'bun:test'

import { classifyStrings, diffInventoryStrings, renderStringsMarkdown } from '../strings'
import type { Inventory } from '../types'

function inventory(strings: string[]): Inventory {
  return { version: '2.1.91', sha256: 'x', bytes: 0, commands: [], envVars: [], cliFlags: [], strings }
}

test('diffs inventories as sets', () => {
  const { added, removed } = diffInventoryStrings(inventory(['a', 'b']), inventory(['b', 'c']))
  expect(added).toEqual(['c'])
  expect(removed).toEqual(['a'])
})

test('buckets strings by src, release notes and noise', () => {
  const buckets = classifyStrings(
    ['already ported wording', 'deep link multi-line prompts', '#fff', 'zz', 'Mystery upstream toast'],
    {
      srcText: "const x = 'already ported wording'",
      releaseNotesText: 'Deep-link prompts now support multi-line input',
    },
  )
  expect(buckets.inSrc).toEqual(['already ported wording'])
  expect(buckets.releaseNotes).toEqual(['deep link multi-line prompts'])
  expect(buckets.noise).toEqual(['#fff', 'zz'])
  expect(buckets.unclassified).toEqual(['Mystery upstream toast'])
})

test('matches src despite leading template whitespace', () => {
  const buckets = classifyStrings(['\nImplement this plan.', 'Mystery upstream toast'], {
    srcText: "const x = 'Implement this plan.'",
  })
  expect(buckets.inSrc).toEqual(['\nImplement this plan.'])
  expect(buckets.unclassified).toEqual(['Mystery upstream toast'])
})

test('renders buckets with counts', () => {
  const md = renderStringsMarkdown({
    added: { inSrc: [], releaseNotes: [], noise: ['x'], unclassified: ['Mystery'] },
    removed: { inSrc: [], releaseNotes: [], noise: [], unclassified: [] },
  })
  expect(md).toContain('### Unclassified (1)')
  expect(md).toContain('- `Mystery`')
  expect(md).toContain('### Likely noise (1)')
})
