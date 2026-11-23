import { describe, expect, test } from 'bun:test'

import type { ToolCallData } from '@/lib/session-reducer'

import { mcpViewModel } from '../mcp-model'

function tool(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return { id: 't1', title: 'mcp__playwright__browser_navigate', status: 'complete', ...overrides }
}

describe('mcpViewModel', () => {
  test('splits the qualified name and keeps the input in order', () => {
    const model = mcpViewModel(
      tool({
        title: 'mcp__plugin_playwright_playwright__browser_navigate',
        rawInput: { url: 'https://example.com', action: 'navigate' },
        rawOutput: { output: 'Navigated to example.com' },
      }),
    )
    expect(model).toEqual({
      server: 'plugin_playwright_playwright',
      tool: 'browser_navigate',
      input: [
        { key: 'url', value: 'https://example.com' },
        { key: 'action', value: 'navigate' },
      ],
      images: [],
      output: 'Navigated to example.com',
      errored: false,
    })
  })

  test('renders scalar and structured arguments as text', () => {
    const model = mcpViewModel(tool({ rawInput: { count: 3, dryRun: false, options: { a: 1 }, missing: null } }))
    expect(model?.input).toEqual([
      { key: 'count', value: '3' },
      { key: 'dryRun', value: 'false' },
      { key: 'options', value: '{"a":1}' },
      { key: 'missing', value: 'null' },
    ])
  })

  test('keeps only raster images from the result', () => {
    const model = mcpViewModel(
      tool({
        rawOutput: {
          output: '',
          images: [
            { mediaType: 'image/png', data: 'ok' },
            { mediaType: 'image/svg+xml', data: 'svg' },
            { mediaType: 'image/png', data: '' },
          ],
        },
      }),
    )
    expect(model?.images).toEqual([{ mediaType: 'image/png', data: 'ok' }])
  })

  test('flags an errored result', () => {
    expect(mcpViewModel(tool({ status: 'error', rawOutput: { output: 'boom' } }))?.errored).toBe(true)
  })

  test('falls back for non-MCP tools', () => {
    expect(mcpViewModel(tool({ title: 'Bash', rawInput: { command: 'ls' } }))).toBeNull()
    expect(mcpViewModel(tool({ title: 'mcp__only' }))).toBeNull()
  })
})
