import { describe, expect, test } from 'bun:test'

import { CMDLET_ALLOWLIST } from '../../../tools/PowerShellTool/readOnlyValidation.js'
import { ARG_GATED_CMDLETS } from '../dangerousCmdlets.js'

describe('ARG_GATED_CMDLETS', () => {
  test('covers every allowlisted command gated by a dangerous-args callback', () => {
    const gated = Object.entries(CMDLET_ALLOWLIST)
      .filter(([, config]) => typeof config.additionalCommandIsDangerousCallback === 'function')
      .map(([name]) => name.toLowerCase())
    const missing = gated.filter((name) => !ARG_GATED_CMDLETS.has(name))
    expect(missing).toEqual([])
  })
})
