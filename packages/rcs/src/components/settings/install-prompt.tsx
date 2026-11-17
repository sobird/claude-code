'use client'

import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (!/iphone|ipad|ipod/i.test(ua)) return false
  // Chrome/Firefox on iOS cannot install; only Safari exposes Add to Home Screen.
  return !/crios|fxios/i.test(ua)
}

/**
 * PWA install affordance. Uses the captured `beforeinstallprompt` event when
 * the browser offers one, shows an iOS Safari hint otherwise, and hides once
 * the app is installed or the user dismisses the prompt.
 */
export function InstallPrompt() {
  const t = useTranslations('settings.install')
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())
    setIos(isIosSafari())

    function handleBeforeInstall(event: Event): void {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }

    function handleInstalled(): void {
      setInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  if (installed || dismissed) return null
  if (!promptEvent && !ios) return null

  async function handleInstall(): Promise<void> {
    if (!promptEvent) return
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    setPromptEvent(null)
    if (choice?.outcome === 'accepted') setInstalled(true)
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <CardTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</CardTitle>
        <CardDescription className="text-sm text-text-muted">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {promptEvent ? (
          <Button type="button" variant="brand" onClick={() => void handleInstall()}>
            <Download className="h-4 w-4" />
            {t('button')}
          </Button>
        ) : (
          <p className="text-sm text-text-secondary">
            {t.rich('iosHint', { b: (chunks) => <span className="font-medium">{chunks}</span> })}
          </p>
        )}
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            {t('dismiss')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
