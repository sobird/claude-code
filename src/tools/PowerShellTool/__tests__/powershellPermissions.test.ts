import { describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext, type ToolUseContext } from '../../../Tool.js'
import { powershellToolHasPermission } from '../powershellPermissions.js'

function contextWithDenyRules(...rules: string[]): ToolUseContext {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        alwaysDenyRules: { session: rules },
      },
    }),
  } as unknown as ToolUseContext
}

describe('parse-failed deny fallback scans every token', () => {
  test('denies an invocation nested behind an assignment', async () => {
    const result = await powershellToolHasPermission(
      { command: '$x = iex p' },
      contextWithDenyRules('PowerShell(Invoke-Expression:*)'),
    )
    expect(result.behavior).toBe('deny')
  })

  test('denies the invocation-operator form', async () => {
    const result = await powershellToolHasPermission(
      { command: "& 'iex' p" },
      contextWithDenyRules('PowerShell(Invoke-Expression:*)'),
    )
    expect(result.behavior).toBe('deny')
  })

  test('hard-denies dangerous Remove-Item targets', async () => {
    const result = await powershellToolHasPermission(
      { command: 'Remove-Item /' },
      contextWithDenyRules('PowerShell(Get-Process:*)'),
    )
    expect(result.behavior).toBe('deny')
    expect(result.decisionReason).toEqual(
      expect.objectContaining({ reason: 'Removal targets a protected system path' }),
    )
  })
})
