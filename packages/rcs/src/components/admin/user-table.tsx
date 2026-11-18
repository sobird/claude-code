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

import styles from './user-table.module.css'

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
      <SelectTrigger size="sm" className={styles.roleTrigger} aria-label={t('role')} title={title}>
        <SelectValue items={{ admin: tCommon('role.admin'), member: tCommon('role.member') }} />
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
    <Badge variant={disabled ? 'destructive' : 'secondary'} className={styles.statusPill}>
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
        <RotateCcw className={styles.smallIcon} />
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
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle className={styles.dialogTitle}>{t('title')}</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="new-username" className={styles.label}>
              {t('username')}
            </Label>
            <Input
              id="new-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              disabled={pending}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="new-display-name" className={styles.label}>
              {t('displayName')}
            </Label>
            <Input
              id="new-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
              disabled={pending}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="new-user-password" className={styles.label}>
              {t('password')}
            </Label>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={pending}
              className={styles.input}
            />
            <p className={styles.hint}>{t('passwordHint')}</p>
          </div>

          <div className={styles.field}>
            <Label htmlFor="new-user-role" className={styles.label}>
              {t('role')}
            </Label>
            <Select
              value={role}
              onValueChange={(next) => {
                if (next === 'admin' || next === 'member') setRole(next)
              }}
              disabled={pending}
            >
              <SelectTrigger id="new-user-role" className={styles.fullTrigger}>
                <SelectValue items={{ admin: tCommon('role.admin'), member: tCommon('role.member') }} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{tCommon('role.member')}</SelectItem>
                <SelectItem value="admin">{tCommon('role.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p role="alert" className={styles.formError}>
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
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle className={styles.dialogTitle}>{t('title')}</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>
            {t('description', { username: user?.username ?? t('thisUser') })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="reset-password" className={styles.label}>
              {t('password')}
            </Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={pending}
              className={styles.input}
            />
          </div>

          {error ? (
            <p role="alert" className={styles.formError}>
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
    <Card className={styles.card}>
      <CardHeader>
        <div className={styles.header}>
          <div className={styles.heading}>
            <CardTitle className={styles.title}>{t('title')}</CardTitle>
            <CardDescription className={styles.description}>
              {t('description', { users: users.length, admins: enabledAdmins })}
            </CardDescription>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className={styles.icon} />
            {t('create')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className={styles.content}>
        {actionError !== null ? (
          <p role="alert" className={styles.error}>
            {describeError(actionError, 'errors.generic')}
          </p>
        ) : null}

        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
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

        {loading && users.length === 0 ? (
          <p className={styles.muted}>{t('loading')}</p>
        ) : users.length === 0 ? (
          <div className={styles.empty}>{t('empty')}</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead className={styles.thead}>
                  <tr>
                    <th className={styles.th}>{tFields('user')}</th>
                    <th className={styles.th}>{tFields('role')}</th>
                    <th className={styles.th}>{tFields('status')}</th>
                    <th className={styles.th}>{tFields('created')}</th>
                    <th className={styles.thEnd}>{tFields('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const lastAdmin = isLastEnabledAdmin(user)
                    return (
                      <tr key={user.id} className={styles.tr}>
                        <td className={styles.td}>
                          <div className={styles.username}>
                            {user.username}
                            {user.id === currentUserId ? <span className={styles.you}>{t('you')}</span> : null}
                          </div>
                          {user.display_name ? <div className={styles.subtext}>{user.display_name}</div> : null}
                        </td>
                        <td className={styles.td}>
                          <RoleSelect
                            value={user.role}
                            disabled={busyId === user.id || lastAdmin}
                            title={lastAdmin ? tAdmin('actions.lastAdminDemote') : undefined}
                            onChange={(role) => void mutateUser(user.id, { role })}
                          />
                        </td>
                        <td className={styles.td}>
                          <StatusPill user={user} />
                        </td>
                        <td className={styles.tdMuted}>{formatIsoDate(user.created_at, locale)}</td>
                        <td className={styles.td}>
                          <div className={styles.rowActions}>
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
            <ul className={styles.cards}>
              {users.map((user) => {
                const lastAdmin = isLastEnabledAdmin(user)
                return (
                  <li key={user.id} className={styles.cardItem}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardBody}>
                        <div className={styles.cardUsername}>
                          {user.username}
                          {user.id === currentUserId ? <span className={styles.you}>{t('you')}</span> : null}
                        </div>
                        {user.display_name ? <div className={styles.cardSubtext}>{user.display_name}</div> : null}
                      </div>
                      <StatusPill user={user} />
                    </div>
                    <div className={styles.cardMeta}>
                      <span>{t('createdAt', { date: formatIsoDate(user.created_at, locale) })}</span>
                    </div>
                    <div className={styles.cardActions}>
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
