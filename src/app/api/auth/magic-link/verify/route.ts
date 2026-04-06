import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken } from '@/lib/auth/jwt'
import { popReturnTo } from '@/lib/auth/return-to'

function getBaseUrl(request: NextRequest): string {
  const headersList = request.headers
  const host = headersList.get('host') || 'localhost:8347'
  const proto = headersList.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request)
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_token`)
  }

  const user = verifyToken(token)
  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login?error=expired`)
  }

  const sessionToken = signToken(user)

  // Try user-specific key first, then the _pending key set by middleware
  let returnTo = popReturnTo(user.email)
  if (returnTo === '/sessions') {
    const pending = popReturnTo('_pending')
    if (pending !== '/sessions') returnTo = pending
  }

  console.log(`[Magic Link Verify] user=${user.email} returnTo=${returnTo}`)

  const response = NextResponse.redirect(`${baseUrl}${returnTo}`)
  response.cookies.set('ccc_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  return response
}
