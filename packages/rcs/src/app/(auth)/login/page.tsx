import type { Metadata } from 'next'
import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'

import { signIn } from '../../../lib/auth'
import { APP_BASE_PATH } from '../../../lib/auth.config'

export const metadata: Metadata = {
  title: 'Sign in · Remote Control Server',
}

/**
 * Accepts only same-origin paths under `/code`; anything else falls back to the
 * dashboard root so a crafted `next` cannot bounce users off-site.
 */
function sanitizeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return APP_BASE_PATH
  if (value.includes('\\') || value.includes('://') || value.startsWith('//')) return APP_BASE_PATH
  if (value !== APP_BASE_PATH && !value.startsWith(`${APP_BASE_PATH}/`)) return APP_BASE_PATH
  return value
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

async function authenticate(formData: FormData): Promise<void> {
  'use server'

  const username = readField(formData, 'username').trim()
  const password = readField(formData, 'password')
  const next = sanitizeNext(readField(formData, 'next'))

  try {
    await signIn('credentials', { username, password, redirectTo: next })
  } catch (error) {
    if (error instanceof AuthError) {
      // Next prepends the app basePath to server-action redirects, so pass the
      // path *without* `/code` (adding it here yields `/code/code/login`).
      redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`)
    }
    throw error
  }
}

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const next = sanitizeNext(params.next)
  const failed = params.error === 'invalid' || params.error === 'CredentialsSignin'

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-stone-900">
      <div className="w-full max-w-sm space-y-8 rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-700">Remote Control Server</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-stone-500">Use your RCS account to continue.</p>
        </header>

        {failed ? (
          <p
            role="alert"
            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800"
          >
            Invalid username or password.
          </p>
        ) : null}

        <form action={authenticate} className="space-y-5">
          <input type="hidden" name="next" value={next} />

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-stone-700">Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              required
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-stone-700">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-800 focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  )
}
