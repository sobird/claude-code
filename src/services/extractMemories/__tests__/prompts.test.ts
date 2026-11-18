import { describe, expect, test } from 'bun:test'

import { buildExtractMemoriesPrompt } from '../prompts.js'

const DEFERRAL =
  'Apply the memory types, what-not-to-save criteria, and frontmatter format from the Memory section of your system prompt'

describe('buildExtractMemoriesPrompt', () => {
  test('defers memory types and formatting to the system prompt', () => {
    const prompt = buildExtractMemoriesPrompt(12, '', false)

    expect(prompt).toContain(DEFERRAL)
    // The taxonomy and save instructions live in the system prompt now; the
    // extraction prompt must not duplicate them.
    expect(prompt).not.toContain('## How to save memories')
    expect(prompt).not.toContain('## What NOT to save')
  })

  test('mentions scope guidance when team memory is enabled', () => {
    const prompt = buildExtractMemoriesPrompt(12, '', true)

    expect(prompt).toContain('Apply the memory types, scope guidance, what-not-to-save criteria')
  })

  test('lists existing memory files when the manifest is non-empty', () => {
    const prompt = buildExtractMemoriesPrompt(3, '- [Role](user_role.md) — backend engineer', false)

    expect(prompt).toContain('## Existing memory files')
    expect(prompt).toContain('user_role.md')
  })
})
