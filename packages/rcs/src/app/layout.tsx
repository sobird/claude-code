import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { ThemeProvider } from '../lib/theme'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import './globals.css'

export const metadata: Metadata = {
  title: 'Remote Control Server',
  description: 'Remote control for Claude Code sessions',
}

/**
 * Applies the persisted theme before first paint so dark-mode users do not see
 * a light flash. Mirrors the storage key and resolution rules in `lib/theme`.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
