'use client'

import { Plus, RotateCcw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { createApiClient } from '../../lib/api-client'
import { formatIsoDate } from '../../lib/format'
import { useSettingsApi } from '../settings/use-settings-api'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type Role = 'admin' | 'member'

interface AdminUser {
  id: string
  username: string
  display_name: string | null
  role: Role
  disabled_at: string | null
  created_at: string
  updated_at: string
}

interface UserPatch {
  role?: Role
  disabled?: boolean
  displayName?: string
  password?: string
}

interface CreateUserInput {
  username: string
  password: string
  displayName?: string
  role: Role
}

function isDisabled(user: AdminUser): boolean {
  return user.disabled_at !== null
}

function RoleSelect({
  value,
  disabled,
  title,
  onChange,
}: {
  value: Role
  disabled: boolean
  title?: string
  onChange: (role: Role) => void
}) {
  const t = useTranslations('admin.fields')
  const tCommon = useTranslations('common')
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === 'admin' || next === 'member') onChange(next)
      }}
    >
      <SelectTrigger size="sm" className="w-32 bg-surface-2" aria-label={t('role')} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">{tCommon('role.admin')}</SelectItem>
        <SelectItem value="member">{tCommon('role.member')}</SelectItem>
      </SelectContent>
    </Select>
  )
}

function StatusPill({ user }: { user: AdminUser }) {
  const t = useTranslations('admin.status')
  const disabled = isDisabled(user)
  return (
    <Badge variant={disabled ? 'destructive' : 'secondary'} className="text-[11px]">
      {disabled ? t('disabled') : t('enabled')}
    </Badge>
  )
}

function UserActions({
  user,
  busy,
  lastAdmin,
  onToggleDisabled,
  onResetPassword,
}: {
  user: AdminUser
  busy: boolean
  lastAdmin: boolean
  onToggleDisabled: () => void
  onResetPassword: () => void
}) {
  const t = useTranslations('admin.actions')
  const disabled = isDisabled(user)
  const toggleDisabled = busy || lastAdmin
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={toggleDisabled}
        title={lastAdmin ? t('lastAdminDisable') : undefined}
        onClick={onToggleDisabled}
      >
        {disabled ? t('enable') : t('disable')}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onResetPassword}>
        <RotateCcw className="h-3.5 w-3.5" />
        {t('resetPassword')}
      </Button>
    </>
  )
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: CreateUserInput) => Promise<void>
}) {
  const t = useTranslations('admin.create')
  const tCommon = useTranslations('common')
  const describeError = useApiErrorMessage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUsername('')
    setPassword('')
    setDisplayName('')
    setRole('member')
    setPending(false)
    setError(null)
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) return
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setError(t('required'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const trimmedDisplayName = displayName.trim()
      await onCreate({
        username: trimmedUsername,
        password,
        displayName: trimmedDisplayName.length > 0 ? trimmedDisplayName : undefined,
        role,
      })
      onOpenChange(false)
    } catch (createError) {
      setError(describeError(createError, 'errors.generic'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-border bg-surface-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</DialogTitle>
          <DialogDescription className="text-sm text-text-muted">{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-username" className="text-text-secondary">
              {t('username')}
            </Label>
            <Input
              id="new-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-display-name" className="text-text-secondary">
              {t('displayName')}
            </Label>
            <Input
              id="new-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-password" className="text-text-secondary">
              {t('password')}
            </Label>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={pending}
              className="bg-surface-2"
            />
            <p className="text-xs text-text-muted">{t('passwordHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-role" className="text-text-secondary">
              {t('role')}
            </Label>
            <Select
              value={role}
              onValueChange={(next) => {
                if (next === 'admin' || next === 'member') setRole(next)
              }}
              disabled={pending}
            >
              <SelectTrigger id="new-user-role" className="w-full bg-surface-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{tCommon('role.member')}</SelectItem>
                <SelectItem value="admin">{tCommon('role.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-status-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? t('creating') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: AdminUser | null
  onClose: () => void
  onReset: (id: string, password: string) => Promise<void>
}) {
  const t = useTranslations('admin.reset')
  const tCommon = useTranslations('common')
  const describeError = useApiErrorMessage()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setPassword('')
    setPending(false)
    setError(null)
  }, [user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!user || pending) return
    if (password.length === 0) {
      setError(t('required'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onReset(user.id, password)
      onClose()
    } catch (resetError) {
      setError(describeError(resetError, 'errors.generic'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="rounded-2xl border-border bg-surface-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</DialogTitle>
          <DialogDescription className="text-sm text-text-muted">
            {t('description', { username: user?.username ?? t('thisUser') })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password" className="text-text-secondary">
              {t('password')}
            </Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={pending}
              className="bg-surface-2"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-status-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? t('saving') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin user management: list, create, change role, enable/disable, reset password. */
export function UserTable({ currentUserId }: { currentUserId: string }) {
  const t = useTranslations('admin.users')
  const tAdmin = useTranslations('admin')
  const tFields = useTranslations('admin.fields')
  const tNotices = useTranslations('admin.notices')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const describeError = useApiErrorMessage()
  const { token, tokenError, refresh } = useSettingsApi()
  // Key the client on `token`: a provider-held ref would lag one effect flush
  // behind this component's effects, sending the first request unauthenticated.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tokenFailed, setTokenFailed] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<AdminUser[]>('/web/admin/users')
      setUsers(Array.isArray(list) ? list : [])
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

  const enabledAdmins = users.filter((user) => user.role === 'admin' && !isDisabled(user)).length

  function clearFeedback(): void {
    setActionError(null)
    setNotice(null)
  }

  async function mutateUser(id: string, patch: UserPatch): Promise<void> {
    if (busyId !== null) return
    clearFeedback()
    setBusyId(id)
    try {
      await api.patch<AdminUser>(`/web/admin/users/${id}`, patch)
      await load()
    } catch (mutationError) {
      setActionError(mutationError)
    } finally {
      setBusyId(null)
    }
  }

  async function createUser(input: CreateUserInput): Promise<void> {
    clearFeedback()
    await api.post<AdminUser>('/web/admin/users', {
      username: input.username,
      password: input.password,
      role: input.role,
      ...(input.displayName ? { displayName: input.displayName } : {}),
    })
    await load()
    setNotice(tNotices('created', { username: input.username }))
  }

  async function resetPassword(id: string, password: string): Promise<void> {
    clearFeedback()
    await api.patch<AdminUser>(`/web/admin/users/${id}`, { password })
    await load()
    setNotice(tNotices('passwordUpdated'))
  }

  function isLastEnabledAdmin(user: AdminUser): boolean {
    return user.role === 'admin' && !isDisabled(user) && enabledAdmins <= 1
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</CardTitle>
            <CardDescription className="text-sm text-text-muted">
              {t('description', { users: users.length, admins: enabledAdmins })}
            </CardDescription>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('create')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {actionError !== null ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
          >
            {describeError(actionError, 'errors.generic')}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-lg border border-status-active/30 bg-status-active/10 px-3 py-2 text-sm text-status-active"
          >
            {notice}
          </p>
        ) : null}

        {errorMessage !== null ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{errorMessage}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {tCommon('retry')}
            </Button>
          </div>
        ) : null}

        {loading && users.length === 0 ? (
          <p className="text-sm text-text-muted">{t('loading')}</p>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
            {t('empty')}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">{tFields('user')}</th>
                    <th className="px-4 py-3 font-medium">{tFields('role')}</th>
                    <th className="px-4 py-3 font-medium">{tFields('status')}</th>
                    <th className="px-4 py-3 font-medium">{tFields('created')}</th>
                    <th className="px-4 py-3 text-right font-medium">{tFields('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const lastAdmin = isLastEnabledAdmin(user)
                    return (
                      <tr key={user.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 align-middle">
                          <div className="font-medium text-text-primary">
                            {user.username}
                            {user.id === currentUserId ? (
                              <span className="ml-1.5 text-xs font-normal text-text-muted">{t('you')}</span>
                            ) : null}
                          </div>
                          {user.display_name ? (
                            <div className="text-xs text-text-muted">{user.display_name}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <RoleSelect
                            value={user.role}
                            disabled={busyId === user.id || lastAdmin}
                            title={lastAdmin ? tAdmin('actions.lastAdminDemote') : undefined}
                            onChange={(role) => void mutateUser(user.id, { role })}
                          />
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <StatusPill user={user} />
                        </td>
                        <td className="px-4 py-3 align-middle text-xs text-text-muted">
                          {formatIsoDate(user.created_at, locale)}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex justify-end gap-2">
                            <UserActions
                              user={user}
                              busy={busyId === user.id}
                              lastAdmin={lastAdmin}
                              onToggleDisabled={() => void mutateUser(user.id, { disabled: !isDisabled(user) })}
                              onResetPassword={() => {
                                clearFeedback()
                                setResetTarget(user)
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {users.map((user) => {
                const lastAdmin = isLastEnabledAdmin(user)
                return (
                  <li key={user.id} className="space-y-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text-primary">
                          {user.username}
                          {user.id === currentUserId ? (
                            <span className="ml-1.5 text-xs font-normal text-text-muted">{t('you')}</span>
                          ) : null}
                        </div>
                        {user.display_name ? (
                          <div className="truncate text-xs text-text-muted">{user.display_name}</div>
                        ) : null}
                      </div>
                      <StatusPill user={user} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span>{t('createdAt', { date: formatIsoDate(user.created_at, locale) })}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleSelect
                        value={user.role}
                        disabled={busyId === user.id || lastAdmin}
                        title={lastAdmin ? tAdmin('actions.lastAdminDemote') : undefined}
                        onChange={(role) => void mutateUser(user.id, { role })}
                      />
                      <UserActions
                        user={user}
                        busy={busyId === user.id}
                        lastAdmin={lastAdmin}
                        onToggleDisabled={() => void mutateUser(user.id, { disabled: !isDisabled(user) })}
                        onResetPassword={() => {
                          clearFeedback()
                          setResetTarget(user)
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createUser} />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} onReset={resetPassword} />
    </Card>
  )
}
