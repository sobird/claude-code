import { Dashboard } from '../../components/shell/dashboard'
import type { DashboardUser } from '../../components/shell/types'
import { auth } from '../../lib/auth'

interface SessionUser {
  id?: string
  name?: string | null
  role?: string
}

/** `/code` dashboard; the layout guarantees an authenticated session. */
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
