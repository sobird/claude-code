'use client'

import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { createApiClient } from '../../lib/api-client'
import {
  detectPushState,
  subscriptionToRequest,
  urlBase64ToUint8Array,
  type PushEnvironment,
  type PushState,
} from '../../lib/push-subscription'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { useSettingsApi } from './use-settings-api'

interface PushConfig {
  enabled: boolean
  publicKey: string | null
}

/** Read the browser capabilities the pure state machine needs. Client-only. */
function readEnvironment(): PushEnvironment {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  const windowWithPush = window as Window & { PushManager?: unknown }
  const standalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    navigatorWithStandalone.standalone === true

  return {
    secureContext: window.isSecureContext,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: typeof windowWithPush.PushManager !== 'undefined',
    hasNotification: typeof window.Notification !== 'undefined',
    permission: typeof window.Notification !== 'undefined' ? window.Notification.permission : 'default',
    isIos: /iphone|ipad|ipod/i.test(navigator.userAgent),
    isStandalone: standalone,
  }
}

/**
 * Web-push opt-in card. Enables a browser subscription for confirmation
 * notifications, reconciles any pre-existing subscription on mount, and shows
 * a reason when the environment cannot support push.
 */
export function Notifications() {
  const t = useTranslations('settings.notifications')
  const tErrors = useTranslations('errors')
  const describeError = useApiErrorMessage()
  const { token, tokenError, refresh } = useSettingsApi()
  // Key the client on `token` so requests always carry the current token, the
  // same way ApiKeys does.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])

  const [detected, setDetected] = useState(false)
  const [mode, setMode] = useState<PushState>('unsupported')
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [unavailable, setUnavailable] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const environment = readEnvironment()
    setMode(detectPushState(environment))
    setPermission(environment.permission)
    setDetected(true)
  }, [])

  // Re-upsert any existing subscription on mount so rotated endpoints and
  // multiple tabs converge on the same server row.
  useEffect(() => {
    if (!detected || mode !== 'available' || permission !== 'granted') return undefined
    if (token === null || tokenError !== null) return undefined
    let cancelled = false
    async function reconcile(): Promise<void> {
      try {
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()
        if (!existing) return
        const request = subscriptionToRequest(existing.toJSON())
        if (!request) return
        await api.post('/web/push/subscriptions', request)
        if (!cancelled) setSubscribed(true)
      } catch (reconcileError) {
        if (!cancelled) setError(reconcileError)
      }
    }
    void reconcile()
    return () => {
      cancelled = true
    }
  }, [detected, mode, permission, token, tokenError, api])

  const handleEnable = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      // A dismissed prompt resolves to 'default', not 'denied'; keep the card
      // retryable in that case and only latch when the user actually refused.
      if (result === 'denied') {
        setMode('denied')
        return
      }
      if (result !== 'granted') return

      const config = await api.get<PushConfig>('/web/push/config')
      if (!config.enabled || !config.publicKey) {
        setUnavailable(true)
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      })
      const request = subscriptionToRequest(subscription.toJSON())
      if (!request) {
        setError(new Error(t('error')))
        return
      }
      await api.post('/web/push/subscriptions', request)
      setSubscribed(true)
    } catch (enableError) {
      setError(enableError)
    } finally {
      setBusy(false)
    }
  }, [api, busy, t])

  const handleDisable = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const { endpoint } = subscription
        await subscription.unsubscribe()
        // The browser subscription is gone whether or not the DELETE below
        // succeeds, so reflect that immediately and surface request errors apart.
        setSubscribed(false)
        await api.delete(`/web/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`)
      } else {
        setSubscribed(false)
      }
    } catch (disableError) {
      setError(disableError)
    } finally {
      setBusy(false)
    }
  }, [api, busy])

  const tokenWaiting = token === null && tokenError === null
  const tokenUnavailable = token === null && tokenError !== null
  const canToggle = detected && token !== null && mode === 'available' && !unavailable

  const statusLines: string[] = []
  if (tokenUnavailable) {
    statusLines.push(tErrors('tokenUnavailable'))
  } else if (!tokenWaiting && detected) {
    if (mode === 'insecure') statusLines.push(t('insecure'))
    else if (mode === 'unsupported') statusLines.push(t('unavailable'))
    else if (mode === 'ios-needs-install') statusLines.push(t('iosInstall'))
    else if (mode === 'denied') statusLines.push(t('denied'))
    else if (unavailable) statusLines.push(t('unavailable'))
    else statusLines.push(subscribed ? t('enabled') : t('disabled'))
  }

  const errorMessage = error !== null ? describeError(error, 'settings.notifications.error') : null

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</CardTitle>
          <CardDescription className="text-sm text-text-muted">{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {subscribed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || token === null}
            onClick={() => void handleDisable()}
          >
            <Bell className="h-4 w-4" />
            {t('disable')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="brand"
            size="sm"
            disabled={busy || !canToggle}
            onClick={() => void handleEnable()}
          >
            <Bell className="h-4 w-4" />
            {busy ? t('enabling') : t('enable')}
          </Button>
        )}

        {statusLines.map((line) => (
          <p key={line} className="text-sm text-text-secondary">
            {line}
          </p>
        ))}

        {errorMessage !== null ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
          >
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
