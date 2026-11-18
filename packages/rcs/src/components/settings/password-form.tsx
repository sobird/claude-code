'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useState, type FormEvent } from 'react'

import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { createApiClient } from '../../lib/api-client'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { MIN_PASSWORD_LENGTH, validatePasswordChange, type PasswordChangeError } from './settings-utils'
import { useSettingsApi } from './use-settings-api'

import styles from './password-form.module.css'

/** Change the signed-in user's password with inline validation and feedback. */
export function PasswordForm() {
  const t = useTranslations('settings.password')
  const describeError = useApiErrorMessage()
  const { token, refresh } = useSettingsApi()
  // Key the client on `token`: a provider-held ref would lag one effect flush
  // behind this component's effects, sending the first request unauthenticated.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const validationMessages: Record<PasswordChangeError, string> = {
    fill_all: t('errors.fill_all'),
    too_short: t('errors.too_short', { min: MIN_PASSWORD_LENGTH }),
    mismatch: t('errors.mismatch'),
    same_as_current: t('errors.same_as_current'),
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) return

    const validation = validatePasswordChange({ current, next, confirm })
    if (validation) {
      setError(validationMessages[validation])
      setSuccess(null)
      return
    }

    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post<{ status: string }>('/web/account/password', {
        currentPassword: current,
        newPassword: next,
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      setSuccess(t('success'))
    } catch (changeError) {
      setError(describeError(changeError, 'errors.generic'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle className={styles.title}>{t('title')}</CardTitle>
        <CardDescription className={styles.description}>
          {t('description', { min: MIN_PASSWORD_LENGTH })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="current-password" className={styles.label}>
              {t('current')}
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={pending}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="new-password" className={styles.label}>
              {t('next')}
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              disabled={pending}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="confirm-password" className={styles.label}>
              {t('confirm')}
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={pending}
              className={styles.input}
            />
          </div>

          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}

          {success ? (
            <p role="status" className={styles.success}>
              {success}
            </p>
          ) : null}

          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? t('submitting') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
