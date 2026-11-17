import type { Metadata, Viewport } from 'next'

export const baseMetadata: Metadata = {
  title: 'Remote Control Server',
  description: 'Remote control for Claude Code sessions',
  applicationName: 'Remote Control',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Remote Control',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
}

export const baseViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#efeee9' },
    { media: '(prefers-color-scheme: dark)', color: '#2c2a27' },
  ],
}

export function localizedAppMetadata(appName: string, appDescription: string): Metadata {
  return { ...baseMetadata, title: appName, description: appDescription }
}
