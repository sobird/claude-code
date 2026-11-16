'use client'

import { useState, type FormEvent } from 'react'

import { ApiError } from '../../lib/api-client'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { validatePasswordChange } from './settings-utils'
import { useSettingsApi } from './use-settings-api'

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Failed to change password'
}

/** Change the signed-in user's password with inline validation and feedback. */
export function PasswordForm() {
  const { api } = useSettingsApi()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) return

    const validation = validatePasswordChange({ current, next, confirm })
    if (validation) {
      setError(validation)
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
      setSuccess('Password updated.')
    } catch (changeError) {
      setError(toMessage(changeError))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <CardTitle className="font-display text-lg font-semibold text-text-primary">Password</CardTitle>
        <CardDescription className="text-sm text-text-muted">
          Use at least 8 characters. You stay signed in after changing it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password" className="text-text-secondary">
              Current password
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-text-secondary">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-text-secondary">
              Confirm new password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
            >
              {error}
            </p>
          ) : null}

          {success ? (
            <p
              role="status"
              className="rounded-lg border border-status-active/30 bg-status-active/10 px-3 py-2 text-sm text-status-active"
            >
              {success}
            </p>
          ) : null}

          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
