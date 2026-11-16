import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'

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

export default withSerwist(nextConfig)
