import { afterEach, describe, expect, test } from 'bun:test'

import React, { useState } from 'react'

import { Box, Text, useInput } from '../src/ink.js'
import { cleanup, renderForTest } from './ink-harness.js'

function Counter() {
  const [n, setN] = useState(0)
  useInput((input) => {
    if (input === ' ') setN((v) => v + 1)
  })
  return (
    <Box>
      <Text>count: {n}</Text>
    </Box>
  )
}

// Module-level cleanup tears down any instance a case forgot to unmount.
afterEach(cleanup)

describe('frame events (onFrame)', () => {
  test('records timing and a phase breakdown per rendered frame', async () => {
    const app = await renderForTest(<Counter />)
    expect(app.frameEvents.length).toBeGreaterThan(0)

    const [first] = app.frameEvents
    expect(first.durationMs).toBeGreaterThanOrEqual(0)
    // phases is always populated when onFrame is wired (ink.tsx:851).
    expect(first.phases?.write).toBeGreaterThanOrEqual(0)
    expect(first.phases?.patches).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(first.flickers)).toBe(true)
  })

  test('emits another event for each post-input frame', async () => {
    const app = await renderForTest(<Counter />)
    const before = app.frameEvents.length
    app.write(' ')
    await app.tick()
    expect(app.frameEvents.length).toBeGreaterThan(before)
  })
})
