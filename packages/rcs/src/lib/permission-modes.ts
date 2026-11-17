/**
 * Permission modes the web client may request via `set_permission_mode`.
 *
 * `auto` intentionally stays out: it needs the transcript classifier and is
 * usually rejected by policy, so offering it would only produce CLI errors.
 */

export const WEB_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'] as const

export type WebPermissionMode = (typeof WEB_PERMISSION_MODES)[number]

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
