import { describe, expect, test } from 'bun:test'

import { TOOL_VIEWS, toolViewKind } from '../registry'

describe('toolViewKind', () => {
  test('maps registered tools to their view family', () => {
    expect(toolViewKind('Bash')).toBe('bash')
  })

  test('canonicalizes before lookup', () => {
    expect(toolViewKind('Bash (timeout)')).toBe('bash')
  })

  test('maps the prompt tools to their own bodies', () => {
    expect(toolViewKind('TodoWrite')).toBe('todo')
    expect(toolViewKind('AskUserQuestion')).toBe('question')
  })

  test('leaves unregistered tools on the generic body', () => {
    expect(toolViewKind('Task')).toBeNull()
    expect(toolViewKind('mcp__thing__do')).toBeNull()
  })
})

describe('TOOL_VIEWS', () => {
  test('provides a component for every kind a tool resolves to', () => {
    for (const name of ['Bash', 'Read', 'Grep', 'WebFetch', 'TodoWrite', 'AskUserQuestion']) {
      const kind = toolViewKind(name)
      expect(kind).not.toBeNull()
      expect(kind ? TOOL_VIEWS[kind] : undefined).toBeDefined()
    }
  })
})
