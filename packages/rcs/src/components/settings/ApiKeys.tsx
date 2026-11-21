'use client'

import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
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
import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'
import { createApiClient } from '@/lib/api-client'
import { formatIsoDate } from '@/lib/format'

import { maskApiKey } from './settings-utils'
import { useSettingsApi } from './use-settings-api'

import styles from './ApiKeys.module.css'

interface ApiKeyView {
  id: string
  name: string
  prefix: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

interface CreatedApiKey extends ApiKeyView {
  /** Raw secret, returned by the gateway exactly once. */
  key: string
}

/** Manage personal API keys: list, create (key shown once), and revoke. */
export function ApiKeys() {
  const t = useTranslations('settings.apiKeys')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const describeError = useApiErrorMessage()
  const { token, tokenError, refresh } = useSettingsApi()
  // Key the client on `token`: a provider-held ref would lag one effect flush
  // behind this component's effects, sending the first request unauthenticated.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tokenFailed, setTokenFailed] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<ApiKeyView[]>('/web/api-keys')
      setKeys(Array.isArray(list) ? list : [])
      setError(null)
    } catch (loadError) {
      setError(loadError)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (token === null) {
      if (tokenError !== null) {
        setTokenFailed(true)
        setLoading(false)
      }
      return
    }
    setTokenFailed(false)
    void load()
  }, [token, tokenError, load])

  const errorMessage = tokenFailed
    ? tErrors('tokenUnavailable')
    : error !== null
      ? describeError(error, 'errors.generic')
      : null

  function openCreate(): void {
    setName('')
    setActionError(null)
    setCreateOpen(true)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    setActionError(null)
    try {
      const trimmed = name.trim()
      const result = await api.post<CreatedApiKey>('/web/api-keys', trimmed.length > 0 ? { name: trimmed } : {})
      setCreated(result)
      setCopied(false)
      setCopyError(null)
      setCreateOpen(false)
      setName('')
      await load()
    } catch (createError) {
      setActionError(createError)
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }

  async function copyCreatedKey(): Promise<void> {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
      setCopyError(null)
    } catch {
      setCopyError(t('copyError'))
    }
  }

  async function handleRevoke(): Promise<void> {
    if (!revokeTarget || revoking) return
    setRevoking(true)
    setActionError(null)
    try {
      await api.delete<{ status: string }>(`/web/api-keys/${revokeTarget.id}`)
      setRevokeTarget(null)
      await load()
    } catch (revokeError) {
      setActionError(revokeError)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Card className={styles.card}>
      <CardHeader>
        <div className={styles.header}>
          <div className={styles.heading}>
            <CardTitle className={styles.title}>{t('title')}</CardTitle>
            <CardDescription className={styles.description}>{t('description')}</CardDescription>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={openCreate}>
            <Plus className={styles.icon} />
            {t('newKey')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className={styles.content}>
        {created ? (
          <div className={styles.created}>
            <div className={styles.createdRow}>
              <KeyRound className={styles.keyIcon} />
              <div className={styles.createdText}>
                <p className={styles.createdTitle}>{t('createdPanel.title')}</p>
                <p className={styles.secondary}>{t('createdPanel.description')}</p>
              </div>
            </div>
            <pre className={styles.keyValue}>{created.key}</pre>
            {copyError ? (
              <p role="alert" className={styles.copyError}>
                {copyError}
              </p>
            ) : null}
            <div className={styles.createdActions}>
              <Button type="button" variant="brand" size="sm" onClick={() => void copyCreatedKey()}>
                <Copy className={styles.icon} />
                {copied ? t('createdPanel.copied') : t('createdPanel.copy')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreated(null)}>
                {tCommon('done')}
              </Button>
            </div>
          </div>
        ) : null}

        {actionError !== null ? (
          <p role="alert" className={styles.error}>
            {describeError(actionError, 'errors.generic')}
          </p>
        ) : null}

        {errorMessage !== null ? (
          <div role="alert" className={styles.errorBanner}>
            <span>{errorMessage}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {tCommon('retry')}
            </Button>
          </div>
        ) : null}

        {loading && keys.length === 0 ? (
          <p className={styles.muted}>{t('loading')}</p>
        ) : keys.length === 0 ? (
          <div className={styles.empty}>{t('empty')}</div>
        ) : (
          <ul className={styles.list}>
            {keys.map((key) => {
              const revoked = key.revoked_at !== null
              return (
                <li key={key.id} className={styles.item}>
                  <div className={styles.itemBody}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.itemName}>{key.name || tCommon('defaultApiKeyName')}</span>
                      <Badge variant={revoked ? 'destructive' : 'secondary'} className={styles.badge}>
                        {revoked ? t('revoked') : t('active')}
                      </Badge>
                    </div>
                    <div className={styles.masked}>{maskApiKey(key.prefix)}</div>
                    <div className={styles.dates}>
                      <span>{t('created', { date: formatIsoDate(key.created_at, locale) })}</span>
                      <span>
                        {t('lastUsed', {
                          date: key.last_used_at ? formatIsoDate(key.last_used_at, locale) : tCommon('never'),
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={styles.revoke}
                    disabled={revoked || revoking}
                    onClick={() => {
                      setActionError(null)
                      setRevokeTarget(key)
                    }}
                  >
                    <Trash2 className={styles.icon} />
                    {t('revoke')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle className={styles.title}>{t('create.title')}</DialogTitle>
            <DialogDescription className={styles.description}>{t('create.description')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className={styles.form}>
            <div className={styles.field}>
              <Label htmlFor="api-key-name" className={styles.label}>
                {t('create.name')}
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('create.namePlaceholder')}
                disabled={creating}
                className={styles.input}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" variant="brand" disabled={creating}>
                {creating ? t('create.creating') : t('create.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle className={styles.title}>{t('revokeDialog.title')}</DialogTitle>
            <DialogDescription className={styles.description}>
              {t('revokeDialog.description', { name: revokeTarget?.name || tCommon('defaultApiKeyName') })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleRevoke()} disabled={revoking}>
              {revoking ? t('revokeDialog.revoking') : t('revokeDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
