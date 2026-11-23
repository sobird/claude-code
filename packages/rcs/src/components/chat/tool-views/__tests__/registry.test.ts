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

  test('maps the agent tool and its legacy task alias', () => {
    expect(toolViewKind('Agent')).toBe('agent')
    expect(toolViewKind('Task')).toBe('agent')
    expect(toolViewKind('task')).toBe('agent')
  })

  test('maps the task list tools to the task body', () => {
    expect(toolViewKind('TaskCreate')).toBe('task')
    expect(toolViewKind('TaskUpdate')).toBe('task')
    expect(toolViewKind('TaskGet')).toBe('task')
    expect(toolViewKind('TaskList')).toBe('task')
  })

  test('maps the background task tools and their aliases', () => {
    for (const name of ['TaskOutput', 'AgentOutputTool', 'BashOutputTool', 'BashOutput', 'TaskStop', 'KillShell']) {
      expect(toolViewKind(name)).toBe('background')
    }
  })

  test('leaves unregistered tools on the generic body', () => {
    expect(toolViewKind('mcp__thing__do')).toBeNull()
  })
})

describe('TOOL_VIEWS', () => {
  test('provides a component for every kind a tool resolves to', () => {
    for (const name of [
      'Bash',
      'Read',
      'Grep',
      'WebFetch',
      'TodoWrite',
      'AskUserQuestion',
      'Agent',
      'TaskCreate',
      'TaskOutput',
    ]) {
      const kind = toolViewKind(name)
      expect(kind).not.toBeNull()
      expect(kind ? TOOL_VIEWS[kind] : undefined).toBeDefined()
    }
  })
})
