import { afterEach, describe, expect, test } from 'bun:test'

import { setMemoryToggledOff } from '../../../bootstrap/state.js'
import { getAutoMemEntrypoint } from '../../../memdir/paths.js'
import { checkEditableInternalPath, checkReadableInternalPath } from '../filesystem.js'

afterEach(() => {
  setMemoryToggledOff(false)
})

const memoryFile = (): string => getAutoMemEntrypoint()
const input = { file_path: '' }

describe('auto-memory carve-outs while toggled off', () => {
  test('writes to auto-memory are denied with a /toggle-memory hint', () => {
    setMemoryToggledOff(true)

    const result = checkEditableInternalPath(memoryFile(), input)

    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain('Cannot write to memory while it is toggled off')
      expect(result.message).toContain('/toggle-memory')
    }
  })

  test('reads from auto-memory are denied with a /toggle-memory hint', () => {
    setMemoryToggledOff(true)

    const result = checkReadableInternalPath(memoryFile(), input)

    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain('Cannot read memory while it is toggled off')
      expect(result.message).toContain('/toggle-memory')
    }
  })

  test('memory access is allowed again after re-enabling', () => {
    setMemoryToggledOff(true)
    setMemoryToggledOff(false)

    expect(checkEditableInternalPath(memoryFile(), input).behavior).toBe('allow')
    expect(checkReadableInternalPath(memoryFile(), input).behavior).toBe('allow')
  })

  test('non-memory paths are unaffected while toggled off', () => {
    setMemoryToggledOff(true)

    expect(checkEditableInternalPath('/tmp/not-memory/foo.ts', input).behavior).toBe('passthrough')
  })
})
