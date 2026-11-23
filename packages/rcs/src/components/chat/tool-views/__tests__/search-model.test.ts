import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { searchViewModel } from '../search-model'

function tool(title: string, rawInput: Record<string, unknown>, overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title, status: 'complete', rawInput, ...overrides }
}

describe('searchViewModel', () => {
  test('Grep exposes the pattern, scope, and results', () => {
    const model = searchViewModel(
      tool('Grep', { pattern: 'TODO', path: 'src', glob: '*.ts' }, { rawOutput: { output: 'src/a.ts:1: // TODO' } }),
    )
    expect(model).toEqual({
      pattern: 'TODO',
      path: 'src',
      glob: '*.ts',
      output: 'src/a.ts:1: // TODO',
      errored: false,
    })
  })

  test('Glob works without a glob filter', () => {
    const model = searchViewModel(tool('Glob', { pattern: '**/*.ts', path: 'src' }))
    expect(model?.pattern).toBe('**/*.ts')
    expect(model?.glob).toBe('')
  })

  test('returns null without a pattern', () => {
    expect(searchViewModel(tool('Grep', { path: 'src' }))).toBeNull()
  })
})
