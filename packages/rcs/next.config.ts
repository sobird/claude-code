import { networkInterfaces } from 'node:os'

import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const GATEWAY_URL = 'http://localhost:4000'

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
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return []
    // Keep the prefix: `:path*` only captures the segments after it, so a
    // destination of `${GATEWAY_URL}/:path*` would drop e.g. `/web` and hit the
    // wrong gateway route. `/health` is an exact path and needs its own rule.
    const passthrough = ['/v1', '/v2', '/acp', '/web'].map((prefix) => ({
      source: `${prefix}/:path*`,
      destination: `${GATEWAY_URL}${prefix}/:path*`,
    }))
    return [...passthrough, { source: '/health', destination: `${GATEWAY_URL}/health` }]
  },
  allowedDevOrigins: process.env.NODE_ENV === 'development' ? localDevOrigins() : [],
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withSerwist(withNextIntl(nextConfig))
