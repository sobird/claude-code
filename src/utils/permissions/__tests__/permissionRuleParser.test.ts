import { describe, expect, test } from 'bun:test'

import { AGENT_TOOL_NAME } from '../../../tools/AgentTool/constants.js'
import { normalizeLegacyToolName } from '../permissionRuleParser.js'

describe('normalizeLegacyToolName — prototype properties', () => {
  test('a rule named after an Object.prototype property is left untouched', () => {
    expect(normalizeLegacyToolName('toString')).toBe('toString')
    expect(normalizeLegacyToolName('constructor')).toBe('constructor')
    expect(normalizeLegacyToolName('hasOwnProperty')).toBe('hasOwnProperty')
  })

  test('legacy aliases still resolve to their canonical tool name', () => {
    expect(normalizeLegacyToolName('Task')).toBe(AGENT_TOOL_NAME)
  })
})
