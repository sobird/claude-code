import { expect, test } from 'bun:test'

test('getSettingsPath honors CLAUDE_CODE_REMOTE_SETTINGS_PATH override', async () => {
  const { getSettingsPath } = await import('../src/services/remoteManagedSettings/syncCacheState.js')
  const original = process.env.CLAUDE_CODE_REMOTE_SETTINGS_PATH
  try {
    process.env.CLAUDE_CODE_REMOTE_SETTINGS_PATH = '/tmp/override-remote-settings.json'
    expect(getSettingsPath()).toBe('/tmp/override-remote-settings.json')
  } finally {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_REMOTE_SETTINGS_PATH
    } else {
      process.env.CLAUDE_CODE_REMOTE_SETTINGS_PATH = original
    }
  }
})
