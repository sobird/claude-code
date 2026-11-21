import type { Metadata, Viewport } from 'next'

const description = 'Remote control for Claude Code sessions'

function resolveBaseUrl(): URL {
  try {
    return new URL(process.env.RCS_BASE_URL?.trim() || 'http://localhost:3000')
  } catch {
    return new URL('http://localhost:3000')
  }
}

function socialMetadata(title: string, summary: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website',
      siteName: 'Sobird',
      title,
      description: summary,
      images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'Sobird' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: summary,
      images: ['/brand/og.png'],
    },
  }
}

export const baseMetadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: 'Sobird',
  description,
  applicationName: 'Sobird',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sobird',
  },
  // Next.js emits only the standards `mobile-web-app-capable` tag, but iOS gates
  // `apple-touch-startup-image` splashes on the Apple-prefixed one. Keep both.
  other: { 'apple-mobile-web-app-capable': 'yes' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-icon-180.png',
  },
  ...socialMetadata('Sobird', description),
}

export const baseViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#efeee9' },
    { media: '(prefers-color-scheme: dark)', color: '#2c2a27' },
  ],
}

export function localizedAppMetadata(appName: string, appDescription: string): Metadata {
  return {
    ...baseMetadata,
    title: appName,
    description: appDescription,
    ...socialMetadata(appName, appDescription),
  }
}
