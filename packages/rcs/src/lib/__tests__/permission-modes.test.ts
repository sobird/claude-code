import { describe, expect, test } from 'bun:test'

import {
  buildSetPermissionModeRequest,
  isWebPermissionMode,
  WEB_PERMISSION_MODES,
  type WebPermissionMode,
} from '../permission-modes'

describe('isWebPermissionMode', () => {
  test('accepts every advertised mode', () => {
    for (const mode of WEB_PERMISSION_MODES) {
      expect(isWebPermissionMode(mode)).toBe(true)
    }
  })

  test('rejects auto and unknown values', () => {
    expect(isWebPermissionMode('auto')).toBe(false)
    expect(isWebPermissionMode('unknown')).toBe(false)
    expect(isWebPermissionMode(undefined)).toBe(false)
    expect(isWebPermissionMode(null)).toBe(false)
    expect(isWebPermissionMode(1)).toBe(false)
  })
})

describe('buildSetPermissionModeRequest', () => {
  test('wraps the mode in a control_request envelope', () => {
    const mode: WebPermissionMode = 'plan'
    expect(buildSetPermissionModeRequest('req-1', mode)).toEqual({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'set_permission_mode', mode: 'plan' },
    })
  })

  test('carries each mode through unchanged', () => {
    for (const mode of WEB_PERMISSION_MODES) {
      const request = buildSetPermissionModeRequest('req', mode) as {
        request: { mode: WebPermissionMode }
      }
      expect(request.request.mode).toBe(mode)
    }
  })
})
