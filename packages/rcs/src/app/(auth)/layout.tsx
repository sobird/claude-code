import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

import { RootShell } from '../../components/shell/root-shell'
import { loadMessages } from '../../i18n/catalogs'
import { resolveRequestLocale } from '../../i18n/server'
import { localizedAppMetadata } from '../../lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '../globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale()
  const { common } = loadMessages(locale)
  return localizedAppMetadata(common.appName, common.appDescription)
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await resolveRequestLocale()
  const messages = loadMessages(locale)

  return (
    <RootShell lang={locale}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootShell>
  )
}
