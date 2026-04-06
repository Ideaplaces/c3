import { setReturnTo } from '@/lib/auth/return-to'
import { LoginClient } from './LoginClient'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams

  // Store returnTo server-side BEFORE rendering the page.
  // This runs on the server, no client-side timing issues.
  if (params.returnTo) {
    setReturnTo('_pending', params.returnTo)
  }

  return <LoginClient error={params.error} />
}
