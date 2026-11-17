'use server'

import { redirect } from 'next/navigation'

import { signOut } from '../../lib/auth'

/** Clear the Auth.js session, then send the user to the login page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false })
  // `redirect` re-adds the `/code` basePath automatically.
  redirect('/login')
}
