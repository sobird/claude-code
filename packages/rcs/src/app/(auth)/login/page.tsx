import type { Metadata } from 'next'
import { AuthError } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { LOCALE_COOKIE, localeCookieOptions, nextLocaleCookie } from '../../../i18n/locales'
import { signIn } from '../../../lib/auth'
import { signInUrlHasError } from '../../../lib/auth-redirect'
import { getRepositories } from '../../../lib/repos'

import styles from './page.module.css'

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
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <p className={styles.brand}>{t('brand')}</p>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </header>

        {failed ? (
          <p role="alert" className={styles.error}>
            {t('invalidCredentials')}
          </p>
        ) : null}

        <form action={authenticate} className={styles.form}>
          <input type="hidden" name="next" value={next} />

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('username')}</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              required
              className={styles.input}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('password')}</span>
            <input name="password" type="password" autoComplete="current-password" required className={styles.input} />
          </label>

          <button type="submit" className={styles.submit}>
            {t('title')}
          </button>
        </form>
      </div>
    </main>
  )
}
