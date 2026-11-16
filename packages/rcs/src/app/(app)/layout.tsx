import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { DashboardDataProvider } from '../../components/shell/dashboard-data'
import { Navbar } from '../../components/shell/navbar'
import { auth } from '../../lib/auth'
import { signOutAction } from './actions'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

/**
 * Authenticated app shell. Middleware already guards these routes; this check
 * is defense in depth for direct server renders and future route changes.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  if (!sessionUser) redirect('/login?next=/code')

  const user = {
    id: sessionUser.id ?? '',
    name: sessionUser.name ?? '',
    role: sessionUser.role ?? 'member',
  }

  return (
    <DashboardDataProvider>
      <Navbar user={user} signOutAction={signOutAction} />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </DashboardDataProvider>
  )
}
