'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'

import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { CreatedSession, EnvironmentSummary } from './types'

const NO_ENVIRONMENT = 'none'

interface NewSessionDialogProps {
  open: boolean
  environments: EnvironmentSummary[]
  onClose: () => void
  onCreate: (input: { title?: string; environment_id?: string }) => Promise<CreatedSession>
  onCreated: (session: CreatedSession) => void
}

/** Create-session form: optional title plus an optional bridge environment. */
export function NewSessionDialog({ open, environments, onClose, onCreate, onCreated }: NewSessionDialogProps) {
  const t = useTranslations('dashboard')
  const tCommon = useTranslations('common')
  const describeError = useApiErrorMessage()
  const [title, setTitle] = useState('')
  const [environmentId, setEnvironmentId] = useState(NO_ENVIRONMENT)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setEnvironmentId(NO_ENVIRONMENT)
    setError(null)
    setPending(false)
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const input: { title?: string; environment_id?: string } = {}
      const trimmed = title.trim()
      if (trimmed.length > 0) input.title = trimmed
      if (environmentId !== NO_ENVIRONMENT) input.environment_id = environmentId
      const created = await onCreate(input)
      onCreated(created)
    } catch (createError) {
      setError(createError)
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="rounded-2xl border-border bg-surface-1 shadow-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">
            {t('newSession.title')}
          </DialogTitle>
          <DialogDescription className="text-sm text-text-muted">{t('newSession.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-title" className="text-text-secondary">
              {t('newSession.titleLabel')}
            </Label>
            <Input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newSession.titlePlaceholder')}
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-environment" className="text-text-secondary">
              {t('newSession.environmentLabel')}
            </Label>
            <Select value={environmentId} onValueChange={setEnvironmentId} disabled={pending}>
              <SelectTrigger id="session-environment" className="w-full bg-surface-2">
                <SelectValue placeholder={t('newSession.noEnvironment')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ENVIRONMENT}>{t('newSession.noEnvironment')}</SelectItem>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.machine_name || environment.id}
                    {environment.branch ? ` (${environment.branch})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-status-error">
              {describeError(error, 'errors.generic')}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? t('newSession.creating') : t('newSession.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
