/**
 * Pure, runtime-neutral helpers for web push notifications.
 *
 * Imported by the gateway notifier service (server) and by the service worker's
 * message types (browser). Keep this module free of server-only or browser-only
 * imports so both runtimes can load it.
 */

export type PushNotificationKind = 'permission' | 'question' | 'plan'

export interface PushNotificationPayload {
  v: 1
  kind: PushNotificationKind
  sessionId: string
  sessionTitle?: string
  toolName: string
  description?: string
  requestId: string
}

const DEFAULT_WINDOW_MS = 60_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** True for `control_request` events whose payload asks to run a tool. */
export function isConfirmationRequest(type: string, payload: unknown): boolean {
  if (type !== 'control_request') return false
  const record = asRecord(payload)
  if (!record) return false
  const request = asRecord(record.request) ?? record
  return asText(request.subtype) === 'can_use_tool'
}

function notificationKind(toolName: string): PushNotificationKind {
  if (toolName === 'AskUserQuestion') return 'question'
  if (toolName === 'ExitPlanMode') return 'plan'
  return 'permission'
}

/**
 * Builds the payload pushed to a subscription for a confirmation request, or
 * `null` when the event is not one or lacks the identifiers a notification needs.
 */
export function buildNotificationPayload(
  session: { id: string; title: string | null },
  type: string,
  payload: unknown,
): PushNotificationPayload | null {
  if (!isConfirmationRequest(type, payload)) return null
  const record = asRecord(payload)
  if (!record) return null
  const request = asRecord(record.request) ?? record

  const requestId = asText(record.request_id) || asText(request.request_id)
  const toolName = asText(request.tool_name)
  if (!requestId || !toolName) return null

  const description = asText(request.description)
  const sessionTitle = session.title?.trim() ? session.title : undefined

  return {
    v: 1,
    kind: notificationKind(toolName),
    sessionId: session.id,
    ...(sessionTitle ? { sessionTitle } : {}),
    toolName,
    ...(description ? { description } : {}),
    requestId,
  }
}

/**
 * Returns `true` the first time a key is seen, then `false` until it has been
 * idle longer than `windowMs`. Entries past the window are pruned on each call.
 */
export function shouldNotifyOnce(
  seen: Map<string, number>,
  key: string,
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  for (const [tracked, timestamp] of seen) {
    if (now - timestamp >= windowMs) seen.delete(tracked)
  }
  if (seen.has(key)) return false
  seen.set(key, now)
  return true
}
