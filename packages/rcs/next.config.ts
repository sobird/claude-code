import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const GATEWAY_URL = 'http://localhost:4000'

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
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withSerwist(withNextIntl(nextConfig))
