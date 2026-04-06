import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken } from '@/lib/auth/jwt'

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

  // Read returnTo from cookie (set by middleware when user was redirected to login)
  const returnTo = request.cookies.get('ccc_return_to')?.value || '/sessions'
  const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/sessions'

  console.log(`[Magic Link Verify] user=${user.email} returnTo=${safePath}`)

  const response = NextResponse.redirect(`${baseUrl}${safePath}`)

  // Set session cookie
  response.cookies.set('ccc_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  // Clear the returnTo cookie
  response.cookies.delete('ccc_return_to')

  return response
}
