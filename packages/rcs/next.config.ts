import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const GATEWAY_URL = 'http://localhost:4000'

const nextConfig: NextConfig = {
  basePath: '/code',
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return []
    return ['/v1/:path*', '/v2/:path*', '/acp/:path*', '/web/:path*'].map((source) => ({
      source,
      destination: `${GATEWAY_URL}/:path*`,
    }))
  },
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withSerwist(withNextIntl(nextConfig))
