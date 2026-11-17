import { describe, expect, it } from 'bun:test'

import { augmentBridgePermissionInput } from '../bridgePlanInput.js'

describe('augmentBridgePermissionInput', () => {
  it('leaves non-ExitPlanMode inputs untouched', () => {
    const input = { command: 'ls' }
    expect(augmentBridgePermissionInput('Bash', input, 'the plan')).toBe(input)
  })

  it('leaves the input untouched when there is no plan', () => {
    const input = { allowedPrompts: [] }
    expect(augmentBridgePermissionInput('ExitPlanMode', input, null)).toBe(input)
    expect(augmentBridgePermissionInput('ExitPlanMode', input, '')).toBe(input)
    expect(augmentBridgePermissionInput('ExitPlanMode', input, '   ')).toBe(input)
  })

  it('adds the plan while preserving the existing fields', () => {
    const allowedPrompts = [{ tool: 'Bash', prompt: 'run tests' }]
    const result = augmentBridgePermissionInput('ExitPlanMode', { allowedPrompts }, '# Plan\n\nDo things.')
    expect(result).toEqual({ allowedPrompts, plan: '# Plan\n\nDo things.' })
  })

  it('does not mutate the original input', () => {
    const input = { allowedPrompts: [] }
    augmentBridgePermissionInput('ExitPlanMode', input, 'plan')
    expect(input).toEqual({ allowedPrompts: [] })
  })
})
