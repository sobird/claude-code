import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { getCwd, isInCwdOverride, runWithCwdOverride, setCwdForCurrentContext } from '../cwd.js'

const parentDir = resolve('/tmp/cwd-parent')
const subagentDir = resolve('/tmp/cwd-subagent')

describe('cwd override isolation', () => {
  let original: string

  beforeEach(() => {
    original = getCwdState()
    setCwdState(parentDir)
  })

  afterEach(() => {
    setCwdState(original)
  })

  test('setting cwd outside an override updates the global state', () => {
    const next = resolve('/tmp/cwd-global')
    setCwdForCurrentContext(next)
    expect(getCwd()).toBe(next)
    expect(isInCwdOverride()).toBe(false)
  })

  test('a subagent cd does not leak back to the parent cwd', async () => {
    await runWithCwdOverride(subagentDir, async () => {
      expect(isInCwdOverride()).toBe(true)
      expect(getCwd()).toBe(subagentDir)
      setCwdForCurrentContext(resolve(`${subagentDir}/nested`))
      expect(getCwd()).toBe(resolve(`${subagentDir}/nested`))
    })
    // Parent's global cwd is untouched.
    expect(getCwd()).toBe(parentDir)
  })

  test('nested overrides stay isolated from one another', async () => {
    await runWithCwdOverride(subagentDir, async () => {
      setCwdForCurrentContext(resolve(`${subagentDir}/first`))
      await runWithCwdOverride(resolve('/tmp/cwd-inner'), async () => {
        setCwdForCurrentContext(resolve('/tmp/cwd-inner/changed'))
        expect(getCwd()).toBe(resolve('/tmp/cwd-inner/changed'))
      })
      // Back in the outer override, its own cwd is preserved.
      expect(getCwd()).toBe(resolve(`${subagentDir}/first`))
    })
    expect(getCwd()).toBe(parentDir)
  })

  test('the override does not survive past its scope', () => {
    runWithCwdOverride(subagentDir, () => {})
    expect(isInCwdOverride()).toBe(false)
    expect(getCwd()).toBe(parentDir)
  })
})
