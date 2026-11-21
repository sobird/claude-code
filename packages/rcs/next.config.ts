import { networkInterfaces } from 'node:os'

import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// Dev assets (`/_next/*`) are fetched from whatever host the browser used, so
// allow this machine's LAN addresses in addition to localhost.
function localDevOrigins(): string[] {
  const origins = new Set(['localhost', '127.0.0.1'])
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) origins.add(info.address)
    }
  }
  return [...origins]
}

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  allowedDevOrigins: process.env.NODE_ENV === 'development' ? localDevOrigins() : [],
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withSerwist(withNextIntl(nextConfig))
