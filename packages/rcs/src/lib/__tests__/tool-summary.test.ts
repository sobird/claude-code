import { describe, expect, test } from 'bun:test'

import { canonicalToolName, summarizeToolCall } from '../tool-summary'

function fieldKeys(name: string, input: Record<string, unknown>): string[] {
  return summarizeToolCall(name, input).fields.map((field) => field.key)
}

describe('canonicalToolName', () => {
  test('maps the legacy Task alias to Agent', () => {
    expect(canonicalToolName('Task')).toBe('Agent')
    expect(canonicalToolName('task')).toBe('Agent')
  })

  test('keeps wire names and trims decoration', () => {
    expect(canonicalToolName('Bash')).toBe('Bash')
    expect(canonicalToolName(' Read ')).toBe('Read')
    expect(canonicalToolName('Bash (background)')).toBe('Bash')
  })
})

describe('summarizeToolCall', () => {
  test('Bash surfaces the command and its description', () => {
    const result = summarizeToolCall('Bash', { command: 'ls -la', description: 'List files' })

    expect(result.name).toBe('Bash')
    expect(result.summary).toBe('ls -la')
    expect(result.fields).toEqual([
      { key: 'command', value: 'ls -la' },
      { key: 'description', value: 'List files' },
    ])
    expect(result.fallback).toBe(false)
  })

  test('Bash omits a missing description', () => {
    expect(fieldKeys('Bash', { command: 'pwd' })).toEqual(['command'])
  })

  test('AskUserQuestion lists each question and summarizes the first', () => {
    const result = summarizeToolCall('AskUserQuestion', {
      questions: [
        { header: 'Genre', question: 'Which genre?', options: [{ label: 'A' }] },
        { header: 'Extras', question: 'Which extras?', options: [{ label: 'B' }] },
      ],
    })

    expect(result.name).toBe('AskUserQuestion')
    expect(result.summary).toBe('Which genre?')
    expect(result.fields).toEqual([
      { key: 'question 1', value: 'Which genre?' },
      { key: 'question 2', value: 'Which extras?' },
    ])
    expect(result.fallback).toBe(false)
  })

  test('Read accepts file_path or the older path field', () => {
    expect(summarizeToolCall('Read', { file_path: '/tmp/a.ts' }).summary).toBe('/tmp/a.ts')
    expect(summarizeToolCall('Read', { path: '/tmp/b.ts' }).summary).toBe('/tmp/b.ts')
  })

  test('file tools report the path they touch', () => {
    expect(fieldKeys('Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' })).toEqual(['file_path'])
    expect(summarizeToolCall('Write', { file_path: '/repo/b.md', content: 'hi' }).summary).toBe('/repo/b.md')
    expect(summarizeToolCall('NotebookEdit', { notebook_path: '/repo/n.ipynb' }).summary).toBe('/repo/n.ipynb')
  })

  test('Glob and Grep summarize their pattern', () => {
    expect(fieldKeys('Glob', { pattern: '**/*.ts', path: 'src' })).toEqual(['pattern', 'path'])
    expect(summarizeToolCall('Grep', { pattern: 'TODO', glob: '*.ts' }).summary).toBe('TODO')
  })

  test('web tools summarize url or query', () => {
    expect(summarizeToolCall('WebFetch', { url: 'https://example.com' }).summary).toBe('https://example.com')
    expect(summarizeToolCall('WebSearch', { query: 'bun test' }).summary).toBe('bun test')
  })

  test('Task resolves to Agent and summarizes its description', () => {
    const result = summarizeToolCall('Task', { description: 'Explore auth', prompt: 'Find the auth code' })

    expect(result.name).toBe('Agent')
    expect(result.summary).toBe('Explore auth')
    expect(result.fields.map((field) => field.key)).toEqual(['description', 'prompt'])
  })

  test('TodoWrite summarizes the first item and counts the list', () => {
    const result = summarizeToolCall('TodoWrite', {
      todos: [
        { content: 'Write tests', status: 'pending' },
        { content: 'Implement', status: 'pending' },
      ],
    })

    expect(result.summary).toBe('Write tests')
    expect(result.fields).toEqual([{ key: 'todos', value: '2' }])
  })

  test('TaskCreate summarizes its subject', () => {
    expect(summarizeToolCall('TaskCreate', { subject: 'Fix scroll' }).summary).toBe('Fix scroll')
  })

  test('unknown tools fall back to compact JSON', () => {
    const result = summarizeToolCall('SomeTool', { a: 1, b: 'two' })

    expect(result.fallback).toBe(true)
    expect(result.name).toBe('SomeTool')
    expect(result.summary).toBe('{"a":1,"b":"two"}')
  })

  test('empty input yields no summary', () => {
    const result = summarizeToolCall('Bash')

    expect(result.fields).toEqual([])
    expect(result.summary).toBe('')
    expect(result.fallback).toBe(false)
  })

  test('summaries are truncated to the requested length', () => {
    const result = summarizeToolCall('Bash', { command: 'x'.repeat(50) }, 10)

    expect(result.summary).toBe(`${'x'.repeat(10)}...`)
    // Fields keep the full value (only the one-line summary is clipped).
    expect(result.fields[0]?.value).toBe('x'.repeat(50))
  })
})
