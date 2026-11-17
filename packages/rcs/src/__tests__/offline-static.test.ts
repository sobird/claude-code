import { describe, expect, test } from 'bun:test'

const appRoot = new URL('../app/', import.meta.url)

test('there is no root layout above the route groups', async () => {
  expect(await Bun.file(new URL('layout.tsx', appRoot)).exists()).toBe(false)
})

describe('~offline stays statically prerenderable', () => {
  const files = ['(offline)/layout.tsx', '(offline)/~offline/page.tsx']

  for (const file of files) {
    test(`${file} does not read request cookies`, async () => {
      const text = await Bun.file(new URL(file, appRoot)).text()
      expect(text).not.toContain('next/headers')
      expect(text).not.toContain('resolveRequestLocale')
    })
  }
})
