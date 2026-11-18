import { describe, expect, test } from 'bun:test'

import type { ParsedCommandElement } from '../../../utils/powershell/parser.js'
import { CMDLET_ALLOWLIST, isAllowlistedCommand } from '../readOnlyValidation.js'

function cmd(
  name: string,
  args: string[],
  elementTypes: ParsedCommandElement['elementTypes'],
  nameType: ParsedCommandElement['nameType'] = 'cmdlet',
): ParsedCommandElement {
  return {
    name,
    nameType,
    elementType: 'CommandAst',
    args,
    text: [name, ...args].join(' '),
    elementTypes,
  }
}

describe('DNS read commands are no longer auto-allowed', () => {
  test('Get-DnsClientCache is not allowlisted', () => {
    expect(isAllowlistedCommand(cmd('Get-DnsClientCache', [], ['Other']), 'Get-DnsClientCache')).toBe(false)
  })

  test('ipconfig /all stays allowlisted but /displaydns does not', () => {
    // `/`-prefixed flags are only validated on win32, so assert the config
    // itself — that's what the Windows flag check consults.
    const ipconfig = CMDLET_ALLOWLIST.ipconfig
    expect(ipconfig?.safeFlags).toContain('/all')
    expect(ipconfig?.safeFlags).not.toContain('/displaydns')
    expect(CMDLET_ALLOWLIST['get-dnsclientcache']).toBeUndefined()
  })
})

describe('arp positional arguments', () => {
  test('rejects a bare host/IP argument', () => {
    expect(isAllowlistedCommand(cmd('arp', ['192.168.1.1'], ['Other', 'StringConstant']), 'arp 192.168.1.1')).toBe(
      false,
    )
  })

  test('keeps display flags allowlisted', () => {
    expect(isAllowlistedCommand(cmd('arp', ['-a'], ['Other', 'Parameter']), 'arp -a')).toBe(true)
  })
})

describe('common action parameter values', () => {
  test('accepts whitelisted -ErrorAction values', () => {
    expect(
      isAllowlistedCommand(
        cmd(
          'Get-Content',
          ['file.txt', '-ErrorAction', 'SilentlyContinue'],
          ['Other', 'StringConstant', 'Parameter', 'StringConstant'],
        ),
        'Get-Content file.txt -ErrorAction SilentlyContinue',
      ),
    ).toBe(true)
    expect(
      isAllowlistedCommand(
        cmd('Get-Content', ['file.txt', '-ErrorAction:Continue'], ['Other', 'StringConstant', 'Parameter']),
        'Get-Content file.txt -ErrorAction:Continue',
      ),
    ).toBe(true)
  })

  test('accepts short action aliases with safe values', () => {
    expect(
      isAllowlistedCommand(
        cmd(
          'Get-Content',
          ['file.txt', '-ea', 'SilentlyContinue'],
          ['Other', 'StringConstant', 'Parameter', 'StringConstant'],
        ),
        'Get-Content file.txt -ea SilentlyContinue',
      ),
    ).toBe(true)
  })

  test('rejects -ErrorAction Break and unknown values', () => {
    expect(
      isAllowlistedCommand(
        cmd(
          'Get-Content',
          ['file.txt', '-ErrorAction', 'Break'],
          ['Other', 'StringConstant', 'Parameter', 'StringConstant'],
        ),
        'Get-Content file.txt -ErrorAction Break',
      ),
    ).toBe(false)
    expect(
      isAllowlistedCommand(
        cmd(
          'Get-Content',
          ['file.txt', '-ErrorAction', '3'],
          ['Other', 'StringConstant', 'Parameter', 'StringConstant'],
        ),
        'Get-Content file.txt -ErrorAction 3',
      ),
    ).toBe(false)
  })
})
