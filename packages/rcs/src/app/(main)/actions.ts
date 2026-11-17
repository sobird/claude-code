'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { LOCALE_COOKIE } from '../../i18n/locales'
import { signOut } from '../../lib/auth'

/** Clear the Auth.js session and locale preference, then send the user to the login page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false })
  const jar = await cookies()
  jar.delete(LOCALE_COOKIE)
  // `redirect` re-adds the `/code` basePath automatically.
  redirect('/login')
}
