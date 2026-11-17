/**
 * Permission modes the web client may request via `set_permission_mode`.
 *
 * `auto` intentionally stays out: it needs the transcript classifier and is
 * usually rejected by policy, so offering it would only produce CLI errors.
 */

export const WEB_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'] as const

export type WebPermissionMode = (typeof WEB_PERMISSION_MODES)[number]

/**
 * Order Shift+Tab walks, matching the TUI's non-ant cycle. `dontAsk` stays out so
 * the web-only mode never enters the loop.
 */
const WEB_MODE_CYCLE = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const

/**
 * Next mode in the Shift+Tab cycle. Anything outside the cycle (`dontAsk`, a
 * null mode before `system/init`, or an unknown value) starts over at `default`.
 */
export function nextWebPermissionMode(current: string | null): WebPermissionMode {
  const index = (WEB_MODE_CYCLE as readonly string[]).indexOf(current ?? '')
  if (index === -1) return 'default'
  return WEB_MODE_CYCLE[(index + 1) % WEB_MODE_CYCLE.length]
}

export function isWebPermissionMode(value: unknown): value is WebPermissionMode {
  return typeof value === 'string' && (WEB_PERMISSION_MODES as readonly string[]).includes(value)
}

/** Envelope the CLI expects for a mode switch on the control channel. */
export function buildSetPermissionModeRequest(requestId: string, mode: WebPermissionMode): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_permission_mode', mode },
  }
}
