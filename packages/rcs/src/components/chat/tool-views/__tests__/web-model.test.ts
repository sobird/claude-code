import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { formatBytes, formatDuration, safeHttpUrl, webViewModel } from '../web-model'

function tool(title: string, rawInput: Record<string, unknown>, overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title, status: 'complete', rawInput, ...overrides }
}

describe('webViewModel', () => {
  test('WebFetch exposes the URL and page text', () => {
    const model = webViewModel(tool('WebFetch', { url: 'https://x.dev' }, { rawOutput: { output: 'hello' } }))
    expect(model?.url).toBe('https://x.dev')
    expect(model?.query).toBe('')
    expect(model?.output).toBe('hello')
  })

  test('WebSearch exposes the query', () => {
    const model = webViewModel(tool('WebSearch', { query: 'claude code' }))
    expect(model?.query).toBe('claude code')
    expect(model?.url).toBe('')
  })

  test('returns null without a URL or query', () => {
    expect(webViewModel(tool('WebFetch', {}))).toBeNull()
  })

  test('WebSearch turns its Links payload into sources and strips it from the text', () => {
    const output = [
      'Web search results for query: "claude code"',
      '',
      'Claude Code is a CLI.',
      '',
      'Links: [{"title":"Claude Code","url":"https://claude.com/code"},{"title":"Docs","url":"https://docs.anthropic.com"},{"title":"bad","url":"javascript:alert(1)"}]',
      '',
      'REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.',
    ].join('\n')
    const model = webViewModel(tool('WebSearch', { query: 'claude code' }, { rawOutput: { output } }))
    expect(model?.sources).toEqual([
      { title: 'Claude Code', url: 'https://claude.com/code' },
      { title: 'Docs', url: 'https://docs.anthropic.com' },
    ])
    expect(model?.output).toBe('Web search results for query: "claude code"\n\nClaude Code is a CLI.')
  })

  test('WebFetch reads status, size, and duration from tool_use_result', () => {
    const model = webViewModel(
      tool(
        'WebFetch',
        { url: 'https://x.dev' },
        {
          rawOutput: {
            output: 'hi',
            toolUseResult: {
              code: 200,
              codeText: 'OK',
              bytes: 1536,
              durationMs: 1200,
              url: 'https://x.dev',
              result: 'hi',
            },
          },
        },
      ),
    )
    expect(model?.httpStatus).toBe(200)
    expect(model?.httpStatusText).toBe('OK')
    expect(model?.bytes).toBe(1536)
    expect(model?.durationMs).toBe(1200)
  })

  test('structured fields stay null when absent or malformed', () => {
    const plain = webViewModel(tool('WebFetch', { url: 'https://x.dev' }, { rawOutput: { output: 'hi' } }))
    expect(plain?.httpStatus).toBeNull()
    expect(plain?.bytes).toBeNull()
    const malformed = webViewModel(
      tool('WebFetch', { url: 'https://x.dev' }, { rawOutput: { output: 'hi', toolUseResult: { code: 'ok' } } }),
    )
    expect(malformed?.httpStatus).toBeNull()
    expect(malformed?.durationMs).toBeNull()
  })

  test('a WebFetch result has no sources and keeps its text', () => {
    const model = webViewModel(tool('WebFetch', { url: 'https://x.dev' }, { rawOutput: { output: 'hello' } }))
    expect(model?.sources).toEqual([])
    expect(model?.output).toBe('hello')
  })

  test('keeps a Links line that is not valid JSON', () => {
    const model = webViewModel(
      tool('WebSearch', { query: 'q' }, { rawOutput: { output: 'Links: not json\n\nmore text' } }),
    )
    expect(model?.sources).toEqual([])
    expect(model?.output).toBe('Links: not json\n\nmore text')
  })
})

describe('formatBytes / formatDuration', () => {
  test('renders kilobytes and seconds with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatDuration(1200)).toBe('1.2s')
  })
})

describe('safeHttpUrl', () => {
  test('keeps http and https links', () => {
    expect(safeHttpUrl('https://x.dev/a?b=1')).toBe('https://x.dev/a?b=1')
    expect(safeHttpUrl('http://x.dev')).toBe('http://x.dev')
  })

  test('rejects other schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,x')).toBeNull()
    expect(safeHttpUrl('not a url')).toBeNull()
  })
})
