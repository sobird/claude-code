import { describe, expect, test } from 'bun:test'

import type { PermissionDecisionReason, PermissionResult } from '../PermissionResult.js'
import { hasAskRuleDecision, hasSafetyCheck } from '../permissions.js'

const askRuleReason: PermissionDecisionReason = {
  type: 'rule',
  rule: { source: 'localSettings', ruleBehavior: 'ask', ruleValue: { toolName: 'Bash' } },
}

const allowRuleReason: PermissionDecisionReason = {
  type: 'rule',
  rule: { source: 'localSettings', ruleBehavior: 'allow', ruleValue: { toolName: 'Bash' } },
}

const safetyCheckReason = (classifierApprovable: boolean): PermissionDecisionReason => ({
  type: 'safetyCheck',
  reason: 'blocked',
  classifierApprovable,
})

function compound(...results: PermissionResult[]): PermissionDecisionReason {
  return {
    type: 'subcommandResults',
    reasons: new Map(results.map((result, i) => [`cmd-${i}`, result])),
  }
}

describe('hasAskRuleDecision — compound commands', () => {
  test('a top-level ask rule is detected', () => {
    expect(hasAskRuleDecision(askRuleReason)).toBe(true)
    expect(hasAskRuleDecision(allowRuleReason)).toBe(false)
  })

  test('an ask rule buried in a multi-subcommand prompt is detected', () => {
    const reason = compound(
      { behavior: 'allow', message: '' },
      { behavior: 'ask', message: '', decisionReason: askRuleReason },
    )
    expect(hasAskRuleDecision(reason)).toBe(true)
  })

  test('subcommand allow results are not descended into', () => {
    const reason = compound({ behavior: 'allow', message: '', decisionReason: allowRuleReason })
    expect(hasAskRuleDecision(reason)).toBe(false)
  })
})

describe('hasSafetyCheck — compound commands', () => {
  test('a top-level safety check is detected', () => {
    expect(hasSafetyCheck(safetyCheckReason(true))).toBe(true)
  })

  test('a safety check buried in a multi-subcommand prompt is detected', () => {
    const reason = compound(
      { behavior: 'allow', message: '' },
      { behavior: 'ask', message: '', decisionReason: safetyCheckReason(false) },
    )
    expect(hasSafetyCheck(reason)).toBe(true)
  })

  test('the filter distinguishes classifier-approvable checks', () => {
    expect(hasSafetyCheck(safetyCheckReason(true), (r) => !r.classifierApprovable)).toBe(false)
    expect(hasSafetyCheck(safetyCheckReason(false), (r) => !r.classifierApprovable)).toBe(true)
  })
})
