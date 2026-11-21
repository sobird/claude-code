/**
 * Pure, runtime-neutral helpers for web push notifications.
 *
 * Imported by the gateway notifier service (server) and by the service worker's
 * message types (browser). Keep this module free of server-only or browser-only
 * imports so both runtimes can load it.
 */

import { toWebSessionId } from '@/contracts'

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
    // The service worker compares this against window paths and opens it on
    // click, both in the web-facing `session_…` form the app routes on — not
    // the canonical `cse_…` id the database uses.
    sessionId: toWebSessionId(session.id),
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

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV4_MAPPED_PATTERN = /^::ffff:(.*)$/i
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i

/** Loopback/private/link-local/unspecified IPv4 ranges. */
function isDisallowedIPv4(host: string): boolean {
  const match = IPV4_PATTERN.exec(host)
  if (!match) return false
  const [a, b, c, d] = match.slice(1).map(Number)
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 0 && b === 0 && c === 0 && d === 0)
  )
}

/**
 * Decodes the embedded IPv4 of an IPv4-mapped IPv6 host (`::ffff:…`) to dotted
 * form, accepting both `127.0.0.1` and hex `7f00:1` tails. Returns `null` when
 * the tail is malformed so the caller can fail closed.
 */
function mappedIPv4(remainder: string): string | null {
  if (IPV4_PATTERN.test(remainder)) return remainder
  const groups = remainder.split(':')
  if (groups.length !== 2) return null
  const [hiText, loText] = groups
  if (!HEX_GROUP_PATTERN.test(hiText) || !HEX_GROUP_PATTERN.test(loText)) return null
  const hi = parseInt(hiText, 16)
  const lo = parseInt(loText, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** Loopback/unspecified/unique-local/link-local IPv6 ranges. */
function isDisallowedIPv6(host: string): boolean {
  if (!host.includes(':')) return false
  const mapped = IPV4_MAPPED_PATTERN.exec(host)
  if (mapped) {
    const ipv4 = mappedIPv4(mapped[1])
    if (ipv4 === null || isDisallowedIPv4(ipv4)) return true
    return false
  }
  return (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  )
}

/**
 * True when `value` is a push endpoint the gateway may safely POST to.
 *
 * `web-push` sends notifications by issuing an HTTPS request to the stored
 * endpoint, so an unvalidated value is a server-side request forgery vector: an
 * authenticated member could point it at an internal host. Browser push
 * endpoints are always HTTPS on port 443, so anything else is rejected, as are
 * localhost and loopback/private/link-local IP literals.
 *
 * Runtime-neutral: uses only the global `URL` so the worker bundle can load it.
 */
export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (url.port !== '' && url.port !== '443') return false

  const hostname = url.hostname.toLowerCase()
  if (!hostname) return false
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false

  // `URL.hostname` brackets IPv6 literals; strip them so both forms are checked.
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isDisallowedIPv4(host) || isDisallowedIPv6(host)) return false

  return true
}
