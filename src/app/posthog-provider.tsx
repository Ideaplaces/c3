'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

function getEnvironment(): string {
  if (typeof window === 'undefined') return 'unknown'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return 'local'
  const devDomain = process.env.NEXT_PUBLIC_DEV_DOMAIN
  if (devDomain && host.endsWith(devDomain)) return 'dev'
  return 'production'
}

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'phc_REr8yvSNak9ePrzkQmEJlC1JSMxZLME1QhXntAplPh7'

if (typeof window !== 'undefined') {
  posthog.init(POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: true,
    loaded: (ph) => {
      ph.register({
        environment: getEnvironment(),
        app: 'c3',
      })
    },
  })
}

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthogClient = usePostHog()

  useEffect(() => {
    if (pathname && posthogClient) {
      let url = window.origin + pathname
      if (searchParams.toString()) {
        url = url + '?' + searchParams.toString()
      }
      posthogClient.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams, posthogClient])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
