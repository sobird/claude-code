import { getTranslations } from 'next-intl/server'

import { ApiKeys } from '@/components/settings/ApiKeys'
import { InstallPrompt } from '@/components/settings/InstallPrompt'
import { LanguageSelector } from '@/components/settings/LanguageSelector'
import { Notifications } from '@/components/settings/Notifications'
import { PasswordForm } from '@/components/settings/PasswordForm'
import { SettingsApiProvider } from '@/components/settings/use-settings-api'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { auth } from '@/lib/auth'

import styles from './page.module.css'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

/** `/settings` — account overview, password, API keys, and PWA install. */
export default async function SettingsPage() {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  const t = await getTranslations('settings')
  const tCommon = await getTranslations('common')
  const username = sessionUser?.name ?? tCommon('account')
  const role = sessionUser?.role ?? 'member'
  const roleLabel = role === 'admin' || role === 'member' ? tCommon(`role.${role}`) : role

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.description}>{t('description')}</p>
      </header>

      <Card className={styles.card}>
        <CardHeader>
          <CardTitle className={styles.cardTitle}>{t('account.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className={styles.details}>
            <div className={styles.detail}>
              <dt className={styles.term}>{t('account.username')}</dt>
              <dd className={styles.value}>{username}</dd>
            </div>
            <div className={styles.detail}>
              <dt className={styles.term}>{t('account.role')}</dt>
              <dd>
                <Badge variant={role === 'admin' ? 'default' : 'secondary'} className={styles.roleBadge}>
                  {roleLabel}
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
        <Notifications />
      </SettingsApiProvider>
      <InstallPrompt />
    </div>
  )
}
