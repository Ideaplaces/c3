import type { NextConfig } from 'next'

const isDev = process.env.C3_DEV === 'true'

const nextConfig: NextConfig = {
  output: 'standalone',
  headers: isDev ? async () => [{
    source: '/:path*',
    headers: [
      { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
    ],
  }] : undefined,
}

export default nextConfig
