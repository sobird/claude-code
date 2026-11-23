import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { fileViewModel } from '../file-model'

function tool(title: string, rawInput: Record<string, unknown>, overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title, status: 'complete', rawInput, ...overrides }
}

describe('fileViewModel', () => {
  test('an Edit yields one old/new hunk', () => {
    const model = fileViewModel(
      tool('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }, { rawOutput: { output: 'ok' } }),
    )
    expect(model?.path).toBe('/a.ts')
    expect(model?.hunks).toEqual([{ before: 'x', after: 'y' }])
    expect(model?.output).toBe('ok')
  })

  test('a Write yields a whole-file addition', () => {
    const model = fileViewModel(tool('Write', { file_path: '/a.ts', content: 'hello' }))
    expect(model?.hunks).toEqual([{ before: '', after: 'hello', isNewFile: true }])
  })

  test('a MultiEdit yields one hunk per edit', () => {
    const model = fileViewModel(
      tool('MultiEdit', {
        file_path: '/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    )
    expect(model?.hunks).toHaveLength(2)
  })

  test('a Read has no hunks and surfaces the output', () => {
    const model = fileViewModel(
      tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: 'const a = 1' }, status: 'complete' }),
    )
    expect(model?.hunks).toBeNull()
    expect(model?.output).toBe('const a = 1')
  })

  test('reads notebook_path and marks errors', () => {
    const model = fileViewModel(
      tool('NotebookEdit', { notebook_path: '/n.ipynb' }, { status: 'error', rawOutput: { output: 'bad' } }),
    )
    expect(model?.path).toBe('/n.ipynb')
    expect(model?.errored).toBe(true)
  })

  test('returns null without a path', () => {
    expect(fileViewModel(tool('Edit', { old_string: 'x', new_string: 'y' }))).toBeNull()
  })
})
