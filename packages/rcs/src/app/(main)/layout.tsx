import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { DashboardDataProvider } from '@/components/shell/DashboardData'
import { Navbar } from '@/components/shell/Navbar'
import { NotificationNavigation } from '@/components/shell/NotificationNavigation'
import { RootShell } from '@/components/shell/RootShell'
import { loadMessages } from '@/i18n/catalogs'
import { resolveRequestLocale } from '@/i18n/server'
import { auth } from '@/lib/auth'
import { baseViewport, localizedAppMetadata } from '@/lib/metadata'

import { signOutAction } from './actions'

import styles from './layout.module.css'
// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '@/app/globals.css'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

export const viewport: Viewport = baseViewport

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale()
  const { common } = loadMessages(locale)
  return localizedAppMetadata(common.appName, common.appDescription)
}

/**
 * Authenticated app shell. Middleware already guards these routes; this check
 * is defense in depth for direct server renders and future route changes.
 */
export default async function MainLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  if (!sessionUser) redirect('/login?next=/')

  const user = {
    id: sessionUser.id ?? '',
    name: sessionUser.name ?? '',
    role: sessionUser.role ?? 'member',
  }

  const locale = await resolveRequestLocale()
  const messages = loadMessages(locale)

  return (
    <RootShell lang={locale}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <DashboardDataProvider>
          <Navbar user={user} signOutAction={signOutAction} />
          <NotificationNavigation />
          <main className={styles.main}>{children}</main>
        </DashboardDataProvider>
      </NextIntlClientProvider>
    </RootShell>
  )
}
