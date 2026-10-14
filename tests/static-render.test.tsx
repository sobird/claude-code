import { describe, expect, test } from 'bun:test'

import React from 'react'
import { Box, Text } from 'src/ink.js'
import { renderToAnsiString, renderToString } from 'src/utils/staticRender.js'

function Card({ title, body }: { title: string; body: string }) {
  return (
    <Box borderStyle="round" width={24} flexDirection="column">
      <Text>{title}</Text>
      <Text>{body}</Text>
    </Box>
  )
}

describe('renderToString', () => {
  test('renders component text without ANSI', async () => {
    const out = await renderToString(<Text>hello</Text>)
    expect(out).toContain('hello')
    // Every escape sequence is gone, so no ESC byte survives.
    expect(out).not.toContain('\x1b')
  })

  test('non-TTY output carries no styling, so ANSI and plain agree', async () => {
    const ansi = await renderToAnsiString(<Card title="Title" body="Body" />)
    const plain = await renderToString(<Card title="Title" body="Body" />)
    expect(plain).toContain('Title')
    // Ink only emits SGR codes on a color-capable TTY; here stdout is a plain
    // pipe, so the box-drawing frame is the only decoration and the two match.
    expect(ansi).toBe(plain)
  })

  test('honours the columns width', async () => {
    const text = 'x'.repeat(60)
    const wide = await renderToString(<Text>{text}</Text>, 80)
    const narrow = await renderToString(<Text>{text}</Text>, 10)
    expect(narrow.split('\n').length).toBeGreaterThan(wide.split('\n').length)
  })
})

describe('snapshot regression', () => {
  test('card output matches the stored snapshot', async () => {
    const out = await renderToString(<Card title="Title" body="Body" />)
    expect(out).toMatchSnapshot()
  })
})
