import { describe, expect, test } from 'bun:test'

import { SandboxNetworkConfigSchema, SandboxSettingsSchema } from '../src/entrypoints/sandboxTypes.js'
import { powershellCommandIsSafe } from '../src/tools/PowerShellTool/powershellSecurity.js'
import {
  clearFastModeCooldown,
  getFastModeRuntimeState,
  getFastModeUnavailableReason,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
  triggerFastModeCooldown,
} from '../src/utils/fastMode.js'
import { classifyCommandName, type ParsedPowerShellCommand, stripModulePrefix } from '../src/utils/powershell/parser.js'

describe('fast mode', () => {
  test('CLAUDE_CODE_DISABLE_FAST_MODE reports fast mode unavailable', () => {
    const original = process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    try {
      process.env.CLAUDE_CODE_DISABLE_FAST_MODE = '1'
      expect(isFastModeEnabled()).toBe(false)
      expect(isFastModeAvailable()).toBe(false)
      expect(getFastModeUnavailableReason()).toBe('Fast mode is not available')
    } finally {
      if (original === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
      } else {
        process.env.CLAUDE_CODE_DISABLE_FAST_MODE = original
      }
    }
  })

  test('cooldown state round-trips through the runtime API', () => {
    const original = process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    try {
      triggerFastModeCooldown(Date.now() + 60_000, 'overloaded')
      expect(isFastModeCooldown()).toBe(true)
      const state = getFastModeRuntimeState()
      expect(state.status).toBe('cooldown')
      if (state.status === 'cooldown') {
        expect(state.reason).toBe('overloaded')
      }
    } finally {
      clearFastModeCooldown()
      if (original === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
      } else {
        process.env.CLAUDE_CODE_DISABLE_FAST_MODE = original
      }
    }
    expect(isFastModeCooldown()).toBe(false)
  })
})

describe('PowerShell parser rules', () => {
  test('classifies Verb-Noun cmdlets', () => {
    expect(classifyCommandName('Get-ChildItem')).toBe('cmdlet')
    expect(classifyCommandName('Invoke-Expression')).toBe('cmdlet')
  })

  test('classifies path-qualified names as applications', () => {
    expect(classifyCommandName('./node')).toBe('application')
    expect(classifyCommandName('C:\\Windows\\System32\\pwsh.exe')).toBe('application')
  })

  test('leaves bare non-hyphenated names as unknown (source contract)', () => {
    // R35's example expected 'application'; the parser deliberately returns
    // 'unknown' for an ambiguous bare name with no path separator.
    expect(classifyCommandName('node')).toBe('unknown')
  })

  test('strips a PowerShell module prefix down to the bare cmdlet', () => {
    expect(stripModulePrefix('Microsoft.PowerShell.Management\\Get-ChildItem')).toBe('Get-ChildItem')
    expect(stripModulePrefix('Get-ChildItem')).toBe('Get-ChildItem')
    // Drive-qualified paths are not module prefixes and must be preserved.
    expect(stripModulePrefix('C:\\tools\\pwsh.exe')).toBe('C:\\tools\\pwsh.exe')
  })
})

function parsedSingleCommand(name: string, args: string[] = []): ParsedPowerShellCommand {
  const elements = [name, ...args]
  const text = elements.join(' ')
  return {
    valid: true,
    errors: [],
    statements: [
      {
        statementType: 'PipelineAst',
        commands: [
          {
            name,
            nameType: classifyCommandName(name),
            elementType: 'CommandAst',
            args,
            text,
            elementTypes: elements.map(() => 'StringConstant' as const),
          },
        ],
        redirections: [],
        text,
      },
    ],
    variables: [],
    hasStopParsing: false,
    originalCommand: text,
  }
}

describe('powershellCommandIsSafe', () => {
  test('rejects Invoke-Expression', () => {
    const result = powershellCommandIsSafe(
      'Invoke-Expression "whoami"',
      parsedSingleCommand('Invoke-Expression', ['"whoami"']),
    )
    expect(result.behavior).toBe('ask')
    expect(result.message).toContain('Invoke-Expression')
  })

  test('accepts a benign cmdlet invocation', () => {
    const result = powershellCommandIsSafe('Get-ChildItem', parsedSingleCommand('Get-ChildItem'))
    expect(result.behavior).toBe('passthrough')
  })

  test('asks when the AST could not be parsed', () => {
    const result = powershellCommandIsSafe('Get-', { ...parsedSingleCommand('Get-'), valid: false })
    expect(result.behavior).toBe('ask')
    expect(result.message).toContain('Could not parse')
  })
})

describe('sandbox network/settings schema', () => {
  test('accepts numeric proxy ports', () => {
    expect(SandboxNetworkConfigSchema().safeParse({ httpProxyPort: 8080, socksProxyPort: 1080 }).success).toBe(true)
  })

  test('rejects a string proxy port', () => {
    expect(SandboxNetworkConfigSchema().safeParse({ httpProxyPort: '8080' }).success).toBe(false)
  })

  test('accepts weaker nested/network isolation flags', () => {
    const result = SandboxSettingsSchema().safeParse({
      enableWeakerNestedSandbox: true,
      enableWeakerNetworkIsolation: true,
    })
    expect(result.success).toBe(true)
  })
})
