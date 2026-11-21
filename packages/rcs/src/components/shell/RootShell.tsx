import type { ReactNode } from 'react'

import { ThemeProvider } from '@/lib/theme'

import { ServiceWorkerRegistration } from './ServiceWorkerRegistration'

/**
 * Applies the persisted theme before first paint so dark-mode users do not see
 * a light flash. Mirrors the storage key and resolution rules in `lib/theme`.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`

/** iOS captures these at install time; one static PNG per device size and DPR. */
const startupImages = [
  {
    href: '/icons/splash/light-1320x2868.png',
    media: '(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1206x2622.png',
    media: '(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1290x2796.png',
    media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1170x2532.png',
    media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1242x2688.png',
    media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1284x2778.png',
    media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1179x2556.png',
    media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1242x2208.png',
    media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-1125x2436.png',
    media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    href: '/icons/splash/light-828x1792.png',
    media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-750x1334.png',
    media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-2048x2732.png',
    media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-1668x2388.png',
    media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-1640x2360.png',
    media: '(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-1620x2160.png',
    media: '(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-1536x2048.png',
    media: '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    href: '/icons/splash/light-1488x2266.png',
    media: '(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2)',
  },
]

export function RootShell({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {startupImages.map(({ href, media }) => (
          <link key={href} rel="apple-touch-startup-image" href={href} media={media} />
        ))}
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
