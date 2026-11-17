/**
 * Pure helpers for the web-push notifications settings card.
 *
 * Kept free of React and live browser globals so the state machine and the
 * wire-format conversions can be unit tested directly.
 */

export type PushState = 'unsupported' | 'insecure' | 'ios-needs-install' | 'denied' | 'available'

/** A snapshot of the browser capabilities used to decide whether push is possible. */
export interface PushEnvironment {
  secureContext: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission | 'default'
  isIos: boolean
  isStandalone: boolean
}

/**
 * Pick the most relevant reason push cannot (yet) be enabled. Order matters:
 * an insecure origin blocks everything, and an iOS browser tab has to be
 * installed before it exposes PushManager, so the install hint must win over
 * the generic "unsupported" state (non-installed iOS Safari lacks PushManager).
 */
export function detectPushState(env: PushEnvironment): PushState {
  if (!env.secureContext) return 'insecure'
  if (env.isIos && !env.isStandalone) return 'ios-needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  if (env.permission === 'denied') return 'denied'
  return 'available'
}

/** Decode a URL-safe base64 VAPID key into the bytes `applicationServerKey` expects. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * The JSON shape produced by `PushSubscription.toJSON()`. A live
 * `PushSubscription` exposes no `keys` property, so callers must serialize
 * first; `endpoint` is optional on that type and is rejected when absent.
 */
export interface PushSubscriptionLike {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

export interface PushSubscriptionRequest {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Convert a `PushSubscription.toJSON()` payload into the gateway payload.
 * Returns `null` when the endpoint or either key is blank, so callers never
 * post an unusable row.
 */
export function subscriptionToRequest(subscription: PushSubscriptionLike): PushSubscriptionRequest | null {
  const endpoint = subscription.endpoint?.trim()
  const p256dh = subscription.keys?.p256dh?.trim()
  const auth = subscription.keys?.auth?.trim()
  if (!endpoint || !p256dh || !auth) return null
  return { endpoint, keys: { p256dh, auth } }
}
