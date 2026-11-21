'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { isLocale, SUPPORTED_LOCALES, type Locale } from '@/i18n/locales'
import { PREFERENCES_PATH } from '@/lib/app-paths'

import styles from './LanguageSelector.module.css'

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
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle className={styles.title}>{t('title')}</CardTitle>
        <CardDescription className={styles.description}>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className={styles.content}>
        <div className={styles.field}>
          <Label htmlFor="language-select" className={styles.label}>
            {t('label')}
          </Label>
          <Select
            value={isLocale(activeLocale) ? activeLocale : undefined}
            onValueChange={(value) => {
              if (value !== null) void handleChange(value)
            }}
            disabled={saving}
          >
            <SelectTrigger id="language-select" className={styles.selectTrigger}>
              <SelectValue items={labels} />
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
          <p role="alert" className={styles.error}>
            {t('error')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
