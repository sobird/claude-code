import { expect, test } from 'bun:test'

import { loadConfig } from '../config.js'
import { isSessionClosedStatus, toCompatibleCodeSessionId, toWebSessionId } from '../contracts.js'

test('session id mapping', () => {
  expect(toWebSessionId('cse_abc')).toBe('session_abc')
  expect(toCompatibleCodeSessionId('session_abc')).toBe('cse_abc')
  expect(toCompatibleCodeSessionId('cse_abc')).toBeNull()
})

test('closed statuses', () => {
  expect(isSessionClosedStatus('archived')).toBe(true)
  // A reaped session is resumable; only a deliberate archive is terminal.
  expect(isSessionClosedStatus('inactive')).toBe(false)
  expect(isSessionClosedStatus('idle')).toBe(false)
  expect(isSessionClosedStatus(null)).toBe(false)
})

test('config defaults and required secret', () => {
  const cfg = loadConfig({ RCS_AUTH_SECRET: 'test-secret' } as unknown as NodeJS.ProcessEnv)
  expect(cfg.port).toBe(4000)
  expect(cfg.eventReplayLimit).toBe(5000)
  expect(() => loadConfig({} as unknown as NodeJS.ProcessEnv)).toThrow('RCS_AUTH_SECRET')
})
