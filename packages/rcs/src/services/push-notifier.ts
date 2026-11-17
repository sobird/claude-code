/**
 * Web push notifier.
 *
 * Sends a push notification to every subscription of a session's owner whenever the
 * session awaits a user confirmation (`control_request` / `can_use_tool`). The entry
 * point, `notifyInboundEvent`, is fire-and-forget: it returns immediately, never throws,
 * and never blocks the caller. Until `initPushNotifier` resolves it is a no-op.
 *
 * VAPID keys resolve in order: both environment values, then the stored settings row,
 * then a freshly generated pair that is persisted so restarts keep the same key.
 * `web-push` is imported lazily (via a literal dynamic import) so the gateway bundle
 * carries it while builds and tests that never enable push still resolve it on demand.
 */

import type { GatewayConfig } from '../config.js'
import type { PushVapidKeys } from '../contracts.js'
import type { Repositories } from '../db/repositories/types.js'
import { buildNotificationPayload, isConfirmationRequest, shouldNotifyOnce } from '../lib/push-payload.js'
import { log } from '../logger.js'

export interface PushNotifierProvider {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  generateVapidKeys(): { publicKey: string; privateKey: string }
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; timeout: number },
  ): Promise<void>
}

export interface InitPushNotifierOptions {
  config: GatewayConfig
  repos: Repositories
  /** Test seam; defaults to a lazily imported `web-push`. */
  provider?: PushNotifierProvider
}

interface PushNotifierState {
  enabled: boolean
  publicKey: string | null
  repos: Repositories
  provider: PushNotifierProvider | null
  ready: Promise<void>
}

interface WebPushModule {
  default?: WebPushModule
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  /** Real `web-push` v4 exports this as `generateVAPIDKeys`. */
  generateVAPIDKeys(): { publicKey: string; privateKey: string }
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; timeout: number },
  ): Promise<void>
}

const NOTIFICATION_TTL_SECONDS = 3600
const NOTIFICATION_TIMEOUT_MS = 5000

let state: PushNotifierState | null = null
const seen = new Map<string, number>()

/**
 * Lazily loads `web-push`. The specifier is a literal so `bun build` bundles the
 * package into `dist/gateway.js` — the shipped Docker image has no `node_modules`.
 * Being a dynamic import (not a top-level one) it still resolves on demand.
 */
async function createDefaultProvider(): Promise<PushNotifierProvider> {
  const mod = (await import('web-push')) as unknown as WebPushModule
  const webpush = mod.default ?? mod
  return {
    setVapidDetails: (subject, publicKey, privateKey) => webpush.setVapidDetails(subject, publicKey, privateKey),
    generateVapidKeys: () => webpush.generateVAPIDKeys(),
    sendNotification: (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
  }
}

async function resolveVapidKeys(
  config: GatewayConfig,
  repos: Repositories,
  provider: PushNotifierProvider,
): Promise<PushVapidKeys | null> {
  const { vapidPublicKey, vapidPrivateKey } = config
  if (vapidPublicKey && vapidPrivateKey) {
    return { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: config.vapidSubject }
  }

  const stored = await repos.pushSettings.get()
  if (stored) return stored

  if (vapidPublicKey || vapidPrivateKey) {
    log('[RCS] push notifications disabled: only one VAPID key is configured')
    return null
  }

  const generated = provider.generateVapidKeys()
  const keys: PushVapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: config.vapidSubject,
  }
  await repos.pushSettings.set(keys)
  return keys
}

export async function initPushNotifier(options: InitPushNotifierOptions): Promise<void> {
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const next: PushNotifierState = {
    enabled: false,
    publicKey: null,
    repos: options.repos,
    provider: options.provider ?? null,
    ready,
  }
  state = next

  try {
    const provider = next.provider ?? (await createDefaultProvider())
    next.provider = provider
    const keys = await resolveVapidKeys(options.config, options.repos, provider)
    if (!keys) return
    provider.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
    next.enabled = true
    next.publicKey = keys.publicKey
  } catch (error) {
    log('[RCS] push notifications disabled:', error)
    next.enabled = false
    next.publicKey = null
  } finally {
    resolveReady()
  }
}

export function resetPushNotifierForTests(): void {
  state = null
  seen.clear()
}

export function getPushPublicConfig(): { enabled: boolean; publicKey: string | null } {
  return { enabled: state?.enabled ?? false, publicKey: state?.publicKey ?? null }
}

/** Fire-and-forget; never throws. No-op until init resolves or when push is disabled. */
export function notifyInboundEvent(sessionId: string, type: string, payload: unknown): void {
  const current = state
  if (!current) return
  void current.ready.then(() => run(current, sessionId, type, payload)).catch(() => {})
}

async function run(current: PushNotifierState, sessionId: string, type: string, payload: unknown): Promise<void> {
  const provider = current.provider
  if (!current.enabled || !provider) return
  if (!isConfirmationRequest(type, payload)) return

  const session = await current.repos.sessions.getById(sessionId)
  if (!session || !session.ownerUserId) return

  const notification = buildNotificationPayload(session, type, payload)
  if (!notification) return
  if (!shouldNotifyOnce(seen, `${sessionId}:${notification.requestId}`, Date.now())) return

  const subscriptions = await current.repos.pushSubscriptions.listByUser(session.ownerUserId)
  if (subscriptions.length === 0) return

  const body = JSON.stringify(notification)
  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      provider.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
        { TTL: NOTIFICATION_TTL_SECONDS, timeout: NOTIFICATION_TIMEOUT_MS },
      ),
    ),
  )

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    if (result.status === 'fulfilled') continue
    const statusCode = (result.reason as { statusCode?: number } | null)?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      await current.repos.pushSubscriptions.deleteById(subscriptions[index].id)
      continue
    }
    log('[RCS] push notification failed:', result.reason)
  }
}
