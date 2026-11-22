import { auth } from '@/auth/next'
import { Dashboard } from '@/components/shell/Dashboard'
import type { DashboardUser } from '@/components/shell/types'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

/** Dashboard; the layout guarantees an authenticated session. */
export default async function DashboardPage() {
  const session = await auth()
  const sessionUser = session?.user as SessionUser | undefined
  const user: DashboardUser = {
    id: sessionUser?.id ?? '',
    name: sessionUser?.name ?? '',
    role: sessionUser?.role ?? 'member',
  }

  return <Dashboard user={user} />
}
