import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { UserTable } from '@/components/admin/UserTable'
import { SettingsApiProvider } from '@/components/settings/use-settings-api'
import { auth } from '@/lib/auth'

import styles from './page.module.css'

interface SessionUser {
  id?: string
  role?: string
}

/**
 * `/admin` — user management.
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
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.description}>{t('description')}</p>
      </header>

      <SettingsApiProvider>
        <UserTable currentUserId={sessionUser.id ?? ''} />
      </SettingsApiProvider>
    </div>
  )
}
