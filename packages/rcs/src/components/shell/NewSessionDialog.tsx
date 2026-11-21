'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'

import type { CreatedSession, EnvironmentSummary } from './types'

import styles from './NewSessionDialog.module.css'

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

  const environmentItems: Record<string, string> = {
    [NO_ENVIRONMENT]: t('newSession.noEnvironment'),
    ...Object.fromEntries(
      environments.map((environment) => [
        environment.id,
        `${environment.machine_name || environment.id}${environment.branch ? ` (${environment.branch})` : ''}`,
      ]),
    ),
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle className={styles.title}>{t('newSession.title')}</DialogTitle>
          <DialogDescription className={styles.description}>{t('newSession.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="session-title" className={styles.label}>
              {t('newSession.titleLabel')}
            </Label>
            <Input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newSession.titlePlaceholder')}
              disabled={pending}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="session-environment" className={styles.label}>
              {t('newSession.environmentLabel')}
            </Label>
            <Select
              value={environmentId}
              onValueChange={(value) => {
                if (value !== null) setEnvironmentId(value)
              }}
              disabled={pending}
            >
              <SelectTrigger id="session-environment" className={styles.selectTrigger}>
                <SelectValue items={environmentItems} placeholder={t('newSession.noEnvironment')} />
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
            <p role="alert" className={styles.error}>
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
