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
      files: null,
      matches: null,
    })
  })

  test('reads the file count from a files_with_matches summary', () => {
    const model = searchViewModel(
      tool('Grep', { pattern: 'TODO' }, { rawOutput: { output: 'Found 3 files\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts' } }),
    )
    expect(model?.files).toBe(3)
    expect(model?.matches).toBeNull()
  })

  test('reads the occurrence and file counts from count mode', () => {
    const model = searchViewModel(
      tool(
        'Grep',
        { pattern: 'TODO', output_mode: 'count' },
        { rawOutput: { output: 'src/a.ts:2\nsrc/b.ts:1\n\nFound 3 total occurrences across 2 files.' } },
      ),
    )
    expect(model?.files).toBe(2)
    expect(model?.matches).toBe(3)
  })

  test('reports zero files when nothing matched', () => {
    const model = searchViewModel(tool('Grep', { pattern: 'nope' }, { rawOutput: { output: 'No files found' } }))
    expect(model?.files).toBe(0)
    expect(model?.matches).toBeNull()
  })

  test('prefers the structured numFiles/numMatches over the text summary', () => {
    const model = searchViewModel(
      tool(
        'Grep',
        { pattern: 'TODO' },
        {
          rawOutput: {
            output: 'raw text without a summary',
            toolUseResult: { mode: 'count', numFiles: 2, numMatches: 3 },
          },
        },
      ),
    )
    expect(model?.files).toBe(2)
    expect(model?.matches).toBe(3)
  })

  test('files_with_matches takes numFiles from tool_use_result', () => {
    const model = searchViewModel(
      tool(
        'Grep',
        { pattern: 'TODO' },
        { rawOutput: { output: '', toolUseResult: { mode: 'files_with_matches', numFiles: 5 } } },
      ),
    )
    expect(model?.files).toBe(5)
    expect(model?.matches).toBeNull()
  })

  test('Glob takes numFiles from tool_use_result', () => {
    const model = searchViewModel(
      tool(
        'Glob',
        { pattern: '**/*.ts' },
        { rawOutput: { output: '', toolUseResult: { numFiles: 4, truncated: false } } },
      ),
    )
    expect(model?.files).toBe(4)
  })

  test('counts Glob filenames and skips the truncation notice', () => {
    const model = searchViewModel(
      tool(
        'Glob',
        { pattern: '**/*.ts' },
        {
          rawOutput: {
            output: 'a.ts\nb.ts\nc.ts\n(Results are truncated. Consider using a more specific path or pattern.)',
          },
        },
      ),
    )
    expect(model?.files).toBe(3)
    expect(model?.matches).toBeNull()
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
