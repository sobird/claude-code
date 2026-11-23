import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { safeHttpUrl, webViewModel } from '../web-model'

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
