import type { ReactNode } from 'react'

import { ThemeProvider } from '../../lib/theme'
import { ServiceWorkerRegistration } from './ServiceWorkerRegistration'

/**
 * Applies the persisted theme before first paint so dark-mode users do not see
 * a light flash. Mirrors the storage key and resolution rules in `lib/theme`.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`

export function RootShell({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ServiceWorkerRegistration />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
