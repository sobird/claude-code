'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { isLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n/locales'
import { PREFERENCES_PATH } from '../../lib/app-paths'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/**
 * Locale preference control.
 *
 * Posts the chosen locale to the same-origin Next route (which persists it and
 * sets the `rcs_locale` cookie), then refreshes so the server re-renders the
 * shell with the new catalog.
 */
export function LanguageSelector() {
  const activeLocale = useLocale()
  const t = useTranslations('settings.language')
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const labels: Record<Locale, string> = {
    'zh-CN': t('zhCN'),
    en: t('en'),
  }

  async function handleChange(value: string): Promise<void> {
    if (!isLocale(value)) return

    setSaving(true)
    setError(false)
    try {
      const response = await fetch(PREFERENCES_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: value }),
      })
      if (!response.ok) {
        setError(true)
        return
      }
      router.refresh()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <CardTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</CardTitle>
        <CardDescription className="text-sm text-text-muted">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="language-select" className="text-text-secondary">
            {t('label')}
          </Label>
          <Select
            value={isLocale(activeLocale) ? activeLocale : undefined}
            onValueChange={(value) => void handleChange(value)}
            disabled={saving}
          >
            <SelectTrigger id="language-select" className="w-full bg-surface-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {labels[locale]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-status-error">
            {t('error')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
