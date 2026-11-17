import type { Metadata, Viewport } from 'next'

const BASE_PATH = '/code'

export const baseMetadata: Metadata = {
  title: 'Remote Control Server',
  description: 'Remote control for Claude Code sessions',
  applicationName: 'Remote Control',
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Remote Control',
  },
  icons: {
    icon: `${BASE_PATH}/icons/icon-192.png`,
    apple: `${BASE_PATH}/icons/icon-192.png`,
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
