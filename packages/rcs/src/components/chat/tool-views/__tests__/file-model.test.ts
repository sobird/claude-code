import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { diffStats, fileViewModel, formatInputSize, previewBodyKind, readLinesFromOutput } from '../file-model'

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

  test('a Read of an image exposes its previews', () => {
    const model = fileViewModel(
      tool(
        'Read',
        { file_path: '/repo/a.png' },
        { rawOutput: { output: 'screenshot', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] } },
      ),
    )
    expect(model?.images).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
    expect(model?.output).toBe('screenshot')
  })

  test('drops malformed or non-raster images from persisted payloads', () => {
    const model = fileViewModel(
      tool(
        'Read',
        { file_path: '/repo/a.png' },
        {
          rawOutput: {
            output: '',
            images: [
              { mediaType: 'image/png', data: 'ok' },
              { mediaType: 'image/svg+xml', data: 'PHN2Zz4=' },
              { mediaType: 'image/png', data: '' },
              { mediaType: 'image/png' },
              'not-an-image',
            ],
          },
        },
      ),
    )
    expect(model?.images).toEqual([{ mediaType: 'image/png', data: 'ok' }])
  })

  test('a text tool result has no images', () => {
    const model = fileViewModel(tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: 'const a = 1' } }))
    expect(model?.images).toEqual([])
  })

  test('returns null without a path', () => {
    expect(fileViewModel(tool('Edit', { old_string: 'x', new_string: 'y' }))).toBeNull()
  })

  test('Write exposes its full written content for the preview dialog', () => {
    expect(fileViewModel(tool('Write', { file_path: '/a.ts', content: 'export const a = 1\n' }))?.writtenContent).toBe(
      'export const a = 1\n',
    )
    expect(fileViewModel(tool('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }))?.writtenContent).toBe(
      '',
    )
  })

  test('reports the input size once written content passes 1KB', () => {
    const content = 'x'.repeat(1536)
    expect(fileViewModel(tool('Write', { file_path: '/a.ts', content }))?.inputSize).toBe(1536)
    const newString = '中'.repeat(400) // 1200 UTF-8 bytes
    expect(fileViewModel(tool('Edit', { file_path: '/a.ts', old_string: 'a', new_string: newString }))?.inputSize).toBe(
      1200,
    )
  })

  test('input size stays null for small or read-only calls', () => {
    expect(fileViewModel(tool('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }))?.inputSize).toBeNull()
    expect(fileViewModel(tool('Read', { file_path: '/a.ts' }))?.inputSize).toBeNull()
  })

  test('sums every MultiEdit payload', () => {
    const model = fileViewModel(
      tool('MultiEdit', {
        file_path: '/a.ts',
        edits: [
          { old_string: 'a', new_string: 'x'.repeat(600) },
          { old_string: 'b', new_string: 'y'.repeat(600) },
        ],
      }),
    )
    expect(model?.inputSize).toBe(1200)
  })
})

describe('previewBodyKind', () => {
  test('prefers numbered lines for a Read', () => {
    const model = fileViewModel(tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: '     1→a\n     2→b' } }))
    expect(model && previewBodyKind(model)).toBe('lines')
  })

  test('shows the full written content for a Write instead of its diff', () => {
    const model = fileViewModel(tool('Write', { file_path: '/a.ts', content: 'hello' }))
    expect(model && previewBodyKind(model)).toBe('text')
  })

  test('shows the diff for an Edit', () => {
    const model = fileViewModel(tool('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }))
    expect(model && previewBodyKind(model)).toBe('diff')
  })

  test('falls back to the plain text output', () => {
    const model = fileViewModel(tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: 'const a = 1' } }))
    expect(model && previewBodyKind(model)).toBe('output')
  })

  test('is null when the call carries no content', () => {
    const model = fileViewModel(tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: '' } }))
    expect(model && previewBodyKind(model)).toBeNull()
  })
})

describe('readLinesFromOutput', () => {
  test('parses the padded arrow format Read emits', () => {
    expect(readLinesFromOutput('     1→const a = 1\n     2→\n     3→export {}\n')).toEqual([
      { number: 1, text: 'const a = 1' },
      { number: 2, text: '' },
      { number: 3, text: 'export {}' },
    ])
  })

  test('parses the compact tab format', () => {
    expect(readLinesFromOutput('1\talpha\n2\tbeta')).toEqual([
      { number: 1, text: 'alpha' },
      { number: 2, text: 'beta' },
    ])
  })

  test('rejects output without line numbers', () => {
    expect(readLinesFromOutput('const a = 1\nexport {}')).toBeNull()
    expect(readLinesFromOutput('read 42 lines\nfile.ts')).toBeNull()
  })

  test('rejects non-sequential numbers', () => {
    expect(readLinesFromOutput('1→a\n9→b\n10→c')).toBeNull()
  })

  test('a Read tool carries its lines on the model', () => {
    const model = fileViewModel(
      tool('Read', { file_path: '/a.ts' }, { rawOutput: { output: '     1→const a = 1\n     2→export {}' } }),
    )
    expect(model?.lines).toHaveLength(2)
  })

  test('an Edit keeps hunks and no line view', () => {
    const model = fileViewModel(tool('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }))
    expect(model?.lines).toBeNull()
  })
})

describe('formatInputSize', () => {
  test('renders kilobytes with one decimal', () => {
    expect(formatInputSize(1536)).toBe('1.5 KB')
    expect(formatInputSize(1024)).toBe('1.0 KB')
    expect(formatInputSize(1024 * 1024)).toBe('1024.0 KB')
  })
})

describe('diffStats', () => {
  test('counts only changed lines', () => {
    expect(diffStats([{ before: 'a\nb\nc', after: 'a\nB\nc' }])).toEqual({ added: 1, removed: 1 })
  })

  test('sums every hunk of a multi-edit', () => {
    expect(
      diffStats([
        { before: 'a', after: 'b' },
        { before: '', after: 'new\nlines', isNewFile: true },
      ]),
    ).toEqual({ added: 3, removed: 1 })
  })

  test('ignores trailing-newline noise', () => {
    expect(diffStats([{ before: 'a\n', after: 'a\n' }])).toEqual({ added: 0, removed: 0 })
  })
})
