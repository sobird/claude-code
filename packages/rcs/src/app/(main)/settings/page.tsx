import { ApiKeys } from '../../../components/settings/api-keys'
import { InstallPrompt } from '../../../components/settings/install-prompt'
import { LanguageSelector } from '../../../components/settings/language-selector'
import { PasswordForm } from '../../../components/settings/password-form'
import { SettingsApiProvider } from '../../../components/settings/use-settings-api'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { auth } from '../../../lib/auth'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

/** `/code/settings` — account overview, password, API keys, and PWA install. */
export default async function SettingsPage() {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  const username = sessionUser?.name ?? 'Account'
  const role = sessionUser?.role ?? 'member'

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary">Manage your account password, personal API keys, and app install.</p>
      </header>

      <Card className="border-border bg-surface-1">
        <CardHeader>
          <CardTitle className="font-display text-lg font-semibold text-text-primary">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wide text-text-muted">Username</dt>
              <dd className="font-medium text-text-primary">{username}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wide text-text-muted">Role</dt>
              <dd>
                <Badge variant={role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                  {role}
                </Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <LanguageSelector />

      <SettingsApiProvider>
        <PasswordForm />
        <ApiKeys />
      </SettingsApiProvider>
      <InstallPrompt />
    </div>
  )
}
