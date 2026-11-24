import { describe, expect, test } from 'bun:test'

import { openBrowser, type SpawnDetached } from '../src/open-browser'

describe('openBrowser', () => {
  test('spawns for http(s) URLs and ignores everything else', () => {
    const calls: { command: string; args: string[] }[] = []
    const spawnDetached: SpawnDetached = (command, args) => {
      calls.push({ command, args })
      return { on() {}, unref() {} }
    }

    openBrowser('https://rcs.example.com/device', spawnDetached)
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toContain('https://rcs.example.com/device')

    openBrowser('file:///etc/passwd', spawnDetached)
    openBrowser('javascript:alert(1)', spawnDetached)
    openBrowser('not a url', spawnDetached)
    expect(calls).toHaveLength(1)
  })
})
