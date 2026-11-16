'use client'

import { Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ApiError, createApiClient } from '../../lib/api-client'
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

const CREATE_PASSWORD_HINT = 'Share this password with the user securely.'

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
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === 'admin' || next === 'member') onChange(next)
      }}
    >
      <SelectTrigger size="sm" className="w-32 bg-surface-2" aria-label="Role" title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="member">Member</SelectItem>
      </SelectContent>
    </Select>
  )
}

function StatusPill({ user }: { user: AdminUser }) {
  const disabled = isDisabled(user)
  return (
    <Badge variant={disabled ? 'destructive' : 'secondary'} className="text-[11px]">
      {disabled ? 'Disabled' : 'Enabled'}
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
  const disabled = isDisabled(user)
  const toggleDisabled = busy || lastAdmin
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={toggleDisabled}
        title={lastAdmin ? 'The last enabled admin cannot be disabled.' : undefined}
        onClick={onToggleDisabled}
      >
        {disabled ? 'Enable' : 'Disable'}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onResetPassword}>
        <RotateCcw className="h-3.5 w-3.5" />
        Reset password
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
      setError('Username and password are required.')
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
      setError(toMessage(createError))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-border bg-surface-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">Create user</DialogTitle>
          <DialogDescription className="text-sm text-text-muted">
            New users can sign in immediately with this password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-username" className="text-text-secondary">
              Username
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
              Display name (optional)
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
              Password
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
            <p className="text-xs text-text-muted">{CREATE_PASSWORD_HINT}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-role" className="text-text-secondary">
              Role
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
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
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
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? 'Creating…' : 'Create user'}
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
      setError('Enter a new password.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onReset(user.id, password)
      onClose()
    } catch (resetError) {
      setError(toMessage(resetError))
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
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">Reset password</DialogTitle>
          <DialogDescription className="text-sm text-text-muted">
            Set a new password for {user?.username ?? 'this user'}. Their existing sessions stay signed in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password" className="text-text-secondary">
              New password
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
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? 'Saving…' : 'Set password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin user management: list, create, change role, enable/disable, reset password. */
export function UserTable({ currentUserId }: { currentUserId: string }) {
  const { token, tokenError, refresh } = useSettingsApi()
  // Key the client on `token`: a provider-held ref would lag one effect flush
  // behind this component's effects, sending the first request unauthenticated.
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
      setActionError(toMessage(mutationError))
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
    setNotice(`Created ${input.username}.`)
  }

  async function resetPassword(id: string, password: string): Promise<void> {
    clearFeedback()
    await api.patch<AdminUser>(`/web/admin/users/${id}`, { password })
    await load()
    setNotice('Password updated.')
  }

  function isLastEnabledAdmin(user: AdminUser): boolean {
    return user.role === 'admin' && !isDisabled(user) && enabledAdmins <= 1
  }

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="font-display text-lg font-semibold text-text-primary">Users</CardTitle>
            <CardDescription className="text-sm text-text-muted">
              {users.length} {users.length === 1 ? 'user' : 'users'} · {enabledAdmins} enabled{' '}
              {enabledAdmins === 1 ? 'admin' : 'admins'}
            </CardDescription>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create user
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
          >
            {actionError}
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

        {loading && users.length === 0 ? (
          <p className="text-sm text-text-muted">Loading users…</p>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
            No users yet.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
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
                              <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>
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
                            title={lastAdmin ? 'The last enabled admin cannot be demoted.' : undefined}
                            onChange={(role) => void mutateUser(user.id, { role })}
                          />
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <StatusPill user={user} />
                        </td>
                        <td className="px-4 py-3 align-middle text-xs text-text-muted">
                          {formatDate(user.created_at)}
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
                            <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>
                          ) : null}
                        </div>
                        {user.display_name ? (
                          <div className="truncate text-xs text-text-muted">{user.display_name}</div>
                        ) : null}
                      </div>
                      <StatusPill user={user} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span>Created {formatDate(user.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleSelect
                        value={user.role}
                        disabled={busyId === user.id || lastAdmin}
                        title={lastAdmin ? 'The last enabled admin cannot be demoted.' : undefined}
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
