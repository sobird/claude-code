import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { UserTable } from '../../../components/admin/user-table'
import { SettingsApiProvider } from '../../../components/settings/use-settings-api'
import { auth } from '../../../lib/auth'

interface SessionUser {
  id?: string
  role?: string
}

/**
 * `/code/admin` — user management.
 *
 * The app layout already guarantees an authenticated session; this check is
 * the role gate for the page itself (the gateway enforces it again on every
 * `/web/admin/*` request).
 */
export default async function AdminPage() {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  if (sessionUser?.role !== 'admin') redirect('/')

  const t = await getTranslations('admin')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">{t('title')}</h1>
        <p className="text-sm text-text-secondary">{t('description')}</p>
      </header>

      <SettingsApiProvider>
        <UserTable currentUserId={sessionUser.id ?? ''} />
      </SettingsApiProvider>
    </div>
  )
}
