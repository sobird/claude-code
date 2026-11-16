'use client'

import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ApiError, createApiClient } from '../../lib/api-client'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { maskApiKey } from './settings-utils'
import { useSettingsApi } from './use-settings-api'

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

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

function formatLastUsed(iso: string | null): string {
  return iso ? formatDate(iso) : 'Never'
}

/** Manage personal API keys: list, create (key shown once), and revoke. */
export function ApiKeys() {
  const { token, tokenError, refresh } = useSettingsApi()
  // Key the client on `token`: a provider-held ref would lag one effect flush
  // behind this component's effects, sending the first request unauthenticated.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<ApiKeyView[]>('/web/api-keys')
      setKeys(Array.isArray(list) ? list : [])
      setError(null)
    } catch (loadError) {
      setError(toMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (token === null) {
      if (tokenError !== null) {
        setError('Unable to obtain an access token — check the gateway.')
        setLoading(false)
      }
      return
    }
    void load()
  }, [token, tokenError, load])

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
      setActionError(toMessage(createError))
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
      setCopyError('Could not copy automatically — select and copy the key manually.')
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
      setActionError(toMessage(revokeError))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="font-display text-lg font-semibold text-text-primary">API keys</CardTitle>
            <CardDescription className="text-sm text-text-muted">
              Personal keys for scripts and integrations. Treat them like passwords.
            </CardDescription>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {created ? (
          <div className="space-y-3 rounded-lg border-2 border-brand/50 bg-brand-subtle p-4">
            <div className="flex items-start gap-2">
              <KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" />
              <div className="space-y-1">
                <p className="font-display text-sm font-semibold text-text-primary">Your new API key</p>
                <p className="text-sm text-text-secondary">Copy it now — this is the only time it will be shown.</p>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs break-all whitespace-pre-wrap text-text-primary">
              {created.key}
            </pre>
            {copyError ? (
              <p role="alert" className="text-sm text-status-error">
                {copyError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="brand" size="sm" onClick={() => void copyCreatedKey()}>
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy key'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
          >
            {actionError}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading && keys.length === 0 ? (
          <p className="text-sm text-text-muted">Loading keys…</p>
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
            No API keys yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => {
              const revoked = key.revoked_at !== null
              return (
                <li
                  key={key.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-text-primary">{key.name || 'API key'}</span>
                      <Badge variant={revoked ? 'destructive' : 'secondary'} className="text-[11px]">
                        {revoked ? 'Revoked' : 'Active'}
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-text-secondary">{maskApiKey(key.prefix)}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                      <span>Created {formatDate(key.created_at)}</span>
                      <span>Last used {formatLastUsed(key.last_used_at)}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start text-status-error sm:self-auto"
                    disabled={revoked || revoking}
                    onClick={() => {
                      setActionError(null)
                      setRevokeTarget(key)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Revoke
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl border-border bg-surface-1 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold text-text-primary">New API key</DialogTitle>
            <DialogDescription className="text-sm text-text-muted">
              Give the key a memorable name. The secret is shown once after creation.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="api-key-name" className="text-text-secondary">
                Name (optional)
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI deploy"
                disabled={creating}
                className="bg-surface-2"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={creating}>
                {creating ? 'Creating…' : 'Create key'}
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
        <DialogContent className="rounded-2xl border-border bg-surface-1 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold text-text-primary">Revoke API key</DialogTitle>
            <DialogDescription className="text-sm text-text-muted">
              Any integration using “{revokeTarget?.name || 'this key'}” will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleRevoke()} disabled={revoking}>
              {revoking ? 'Revoking…' : 'Revoke key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
