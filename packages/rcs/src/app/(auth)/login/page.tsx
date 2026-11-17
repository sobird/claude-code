import type { Metadata } from 'next'
import { AuthError } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { LOCALE_COOKIE, localeCookieOptions, nextLocaleCookie } from '../../../i18n/locales'
import { signIn } from '../../../lib/auth'
import { signInUrlHasError } from '../../../lib/auth-redirect'
import { getRepositories } from '../../../lib/repos'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth')
  return { title: t('pageTitle') }
}

/**
 * Accepts only same-origin absolute paths; anything else falls back to the
 * dashboard root so a crafted `next` cannot bounce users off-site.
 */
function sanitizeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '/'
  if (value.includes('\\') || value.includes('://') || value.startsWith('//')) return '/'
  if (!value.startsWith('/')) return '/'
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
    // `{ redirect: false }` makes `signIn` return the redirect URL instead of
    // throwing on bad credentials; the failure shows up as an `error` param.
    // Pass an explicit `redirectTo` too: without it, next-auth derives the
    // callback URL from the request `Referer`, which after a failed attempt is
    // the `?error=invalid` page — a later success then looks like a failure.
    const result = await signIn('credentials', { username, password, redirect: false, redirectTo: next })
    if (typeof result !== 'string' || signInUrlHasError(result)) {
      redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`)
    }

    const record = await getRepositories().users.getByUsername(username.toLowerCase())
    const locale = nextLocaleCookie(record?.locale)
    const jar = await cookies()
    if (locale) jar.set(LOCALE_COOKIE, locale, localeCookieOptions())
    else jar.delete(LOCALE_COOKIE)

    redirect(next)
  } catch (error) {
    if (error instanceof AuthError) {
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
  const t = await getTranslations('auth')

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-6 py-12 text-text-primary">
      <div className="w-full max-w-sm space-y-8 rounded-2xl border border-border bg-surface-1 p-8 shadow-sm">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">{t('brand')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </header>

        {failed ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
          >
            {t('invalidCredentials')}
          </p>
        ) : null}

        <form action={authenticate} className="space-y-5">
          <input type="hidden" name="next" value={next} />

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-text-secondary">{t('username')}</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              required
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-text-secondary">{t('password')}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            {t('title')}
          </button>
        </form>
      </div>
    </main>
  )
}
