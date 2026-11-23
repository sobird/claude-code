import { describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import { syncPermissionRulesFromDisk } from '../permissions.js'

function withAllowRule(command: string): ToolPermissionContext {
  const context = getEmptyToolPermissionContext()
  return {
    ...context,
    alwaysAllowRules: {
      ...context.alwaysAllowRules,
      policySettings: [`Bash(${command})`],
    },
  }
}

describe('syncPermissionRulesFromDisk — removing rules mid-session', () => {
  test('a managed (policy) allow rule removed by an admin is cleared without a restart', () => {
    const context = withAllowRule('ls')
    const synced = syncPermissionRulesFromDisk(context, [])
    expect(synced.alwaysAllowRules.policySettings ?? []).toEqual([])
  })

  test('a saved allow rule removed from disk is cleared', () => {
    const context = getEmptyToolPermissionContext()
    const withUserRule: ToolPermissionContext = {
      ...context,
      alwaysAllowRules: { ...context.alwaysAllowRules, userSettings: ['Bash(ls)'] },
    }
    const synced = syncPermissionRulesFromDisk(withUserRule, [])
    expect(synced.alwaysAllowRules.userSettings ?? []).toEqual([])
  })

  test('a rule that still exists on disk survives the sync', () => {
    const context = getEmptyToolPermissionContext()
    const synced = syncPermissionRulesFromDisk(context, [
      {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'Bash', ruleContent: 'ls' },
      },
    ])
    expect(synced.alwaysAllowRules.userSettings).toEqual(['Bash(ls)'])
  })
})
