import { afterEach, describe, expect, test } from 'bun:test'

import { getMemoryToggledOff, setMemoryToggledOff } from '../../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../../types/command.js'
import toggleMemory from '../index.js'

afterEach(() => {
  setMemoryToggledOff(false)
})

async function run(): Promise<string> {
  const { call } = await toggleMemory.load()
  const result = await call('', {} as LocalJSXCommandContext)
  if (result.type !== 'text') {
    throw new Error(`unexpected result type: ${result.type}`)
  }
  return result.value
}

describe('/toggle-memory', () => {
  test('disables automemory for the session and says so', async () => {
    expect(getMemoryToggledOff()).toBe(false)

    const message = await run()

    expect(getMemoryToggledOff()).toBe(true)
    expect(message).toContain('Automemory disabled for this session')
    expect(message).toContain('/toggle-memory again to re-enable')
  })

  test('re-enables automemory on a second invocation', async () => {
    await run()
    const message = await run()

    expect(getMemoryToggledOff()).toBe(false)
    expect(message).toContain('Automemory re-enabled')
  })

  test('the command is hidden from the command menu but still invokable', () => {
    expect(toggleMemory.name).toBe('toggle-memory')
    expect(toggleMemory.description).toBe('Toggle automemory off/on for this session')
    expect(toggleMemory.isHidden).toBe(false)
  })
})
