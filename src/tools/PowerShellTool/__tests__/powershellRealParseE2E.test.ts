/**
 * Command-level E2E for the 2.1.90 PowerShell deltas, driven by a real pwsh AST
 * parse instead of synthetic elementTypes. Skips when PowerShell is not on PATH
 * so machines without pwsh still pass.
 *
 * Why real parse matters: isAllowlistedCommand's elementTypes/children checks
 * and the permission flow's compound / nested-command detection depend on the
 * actual AST shapes the parser emits (Parameter vs StringConstant, background
 * operator, nested CommandAst). Hand-built fixtures can drift from those.
 */

import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { getEmptyToolPermissionContext, type ToolUseContext } from '../../../Tool.js'
import { getAllCommands, parsePowerShellCommand, type ParsedCommandElement } from '../../../utils/powershell/parser.js'
import { whichSync } from '../../../utils/which.js'
import { powershellToolHasPermission } from '../powershellPermissions.js'
import { isAllowlistedCommand } from '../readOnlyValidation.js'

const hasPwsh = whichSync('pwsh') !== null || whichSync('powershell') !== null

// Bun's 5s per-test default races the parser's own 5s timeout + one retry: on a
// cold, loaded runner the first pwsh spawn can exceed 5s, so Bun kills the test
// before the retry can absorb it and a perfectly good parse is reported as
// valid:false. Give the file the full retry budget plus cold-start headroom.
setDefaultTimeout(30_000)

function permissionContext(): ToolUseContext {
  return {
    getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
  } as unknown as ToolUseContext
}

async function realParse(command: string): Promise<{ cmd: ParsedCommandElement; originalCommand: string }> {
  const parsed = await parsePowerShellCommand(command)
  expect(parsed.valid).toBe(true)
  const cmd = getAllCommands(parsed)[0]
  expect(cmd).toBeDefined()
  return { cmd, originalCommand: parsed.originalCommand }
}

async function permissionBehavior(command: string) {
  return powershellToolHasPermission({ command }, permissionContext())
}

describe.skipIf(!hasPwsh)('real pwsh AST → read-only allowlist', () => {
  test('arp with a positional host is rejected', async () => {
    const { cmd, originalCommand } = await realParse('arp 192.168.1.1')
    expect(cmd.name).toBe('arp')
    expect(cmd.elementTypes).toBeDefined()
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(false)
  })

  test('arp -s with positional ip/mac is rejected', async () => {
    const { cmd, originalCommand } = await realParse('arp -s 10.0.0.1 00:11:22:33:44:55')
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(false)
  })

  test('arp display flags stay allowlisted', async () => {
    const { cmd, originalCommand } = await realParse('arp -a')
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(true)
  })

  test('short action alias -ea with a safe value is allowlisted', async () => {
    const { cmd, originalCommand } = await realParse('Get-Content file.txt -ea SilentlyContinue')
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(true)
  })

  test('short action alias -ea with Break is rejected', async () => {
    const { cmd, originalCommand } = await realParse('Get-Content file.txt -ea Break')
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(false)
  })

  test('Unicode en-dash action alias is normalized like ASCII', async () => {
    // PowerShell's tokenizer accepts U+2013 as a parameter prefix; the parser
    // reports elementType 'Parameter' and keeps the en-dash in arg text.
    const { cmd, originalCommand } = await realParse('Get-Content file.txt \u2013ea SilentlyContinue')
    expect(isAllowlistedCommand(cmd, originalCommand)).toBe(true)
  })
})

describe.skipIf(!hasPwsh)('real pwsh AST → permission flow', () => {
  test('arp host probe requires approval, arp -a auto-allows', async () => {
    // 'passthrough' from the permission flow is what surfaces the approval
    // prompt — it is the not-auto-allowed outcome.
    expect((await permissionBehavior('arp 192.168.1.1')).behavior).toBe('passthrough')
    expect((await permissionBehavior('arp -a')).behavior).toBe('allow')
  })

  test('background job operator & requires approval', async () => {
    const result = await permissionBehavior('Get-Process &')
    expect(result.behavior).toBe('ask')
    expect(result.message).toContain('background job operator')
  })

  test('compound command that extracts an archive requires approval', async () => {
    const result = await permissionBehavior('tar -xf payload.tar; git status')
    expect(result.behavior).toBe('ask')
    expect(result.message).toContain('extracts an archive')
  })

  test('Remove-Item -Recurse on the working directory requires approval', async () => {
    const result = await permissionBehavior('Remove-Item -Recurse .')
    expect(result.behavior).toBe('ask')
    expect(result.message).toContain('would delete the working directory')
  })
})
