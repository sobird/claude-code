import { expect, test } from 'bun:test'

const ADDED = [
  'CLAUDE_CODE_AGENT_COST_STEER',
  'CLAUDE_CODE_BRIEF',
  'CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL',
  'CLAUDE_CODE_REMOTE_SETTINGS_PATH',
  'CLAUDE_CODE_RESUME_THRESHOLD_MINUTES',
  'CLAUDE_CODE_RESUME_TOKEN_THRESHOLD',
  'MCP_CONNECTION_NONBLOCKING',
]
const REMOVED = [
  'CLAUDE_CODE_20250219_BETA_HEADER',
  'CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK',
  'CLAUDE_CODE_DISABLE_MOUSE_CLICKS',
  'CLAUDE_CODE_OVERRIDE_DATE',
  'CLAUDE_CODE_VERIFY_PLAN',
]

test('env docs list added and drop removed', async () => {
  const doc = await Bun.file('docs/environment-variables.md').text()
  for (const v of ADDED) expect(doc).toContain(v)
  for (const v of REMOVED) expect(doc).not.toContain(v)
})

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
