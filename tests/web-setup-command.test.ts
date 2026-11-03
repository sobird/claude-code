import { expect, test } from 'bun:test'

import { features } from '../scripts/config'
import webSetup from '../src/commands/remote-setup/index'

test('web-setup enabled', () => {
  expect(features).toContain('CCR_REMOTE_SETUP')
  expect(webSetup.name).toBe('web-setup')
  expect(webSetup.type).toBe('local-jsx')
  expect(webSetup.description).toBe('Setup Claude Code on the web (requires connecting your GitHub account)')
  expect(webSetup.availability).toEqual(['claude-ai'])
})
