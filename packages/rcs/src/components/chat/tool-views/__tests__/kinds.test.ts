import { describe, expect, test } from 'bun:test'

import { toolViewKind } from '../kinds'

describe('toolViewKind', () => {
  test('maps registered tools to their view family', () => {
    expect(toolViewKind('Bash')).toBe('bash')
  })

  test('canonicalizes before lookup', () => {
    expect(toolViewKind('Bash (timeout)')).toBe('bash')
  })

  test('leaves unregistered tools on the generic body', () => {
    expect(toolViewKind('TodoWrite')).toBeNull()
    expect(toolViewKind('mcp__thing__do')).toBeNull()
  })
})
