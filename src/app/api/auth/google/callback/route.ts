import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getGoogleClient, getGoogleUser } from '@/lib/auth/google'
import { signToken } from '@/lib/auth/jwt'

function getAllowedEmails(): string[] {
  const raw = process.env.CCC_ALLOWED_EMAILS || ''
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookieStore = await cookies()
  const storedState = cookieStore.get('google_oauth_state')?.value
  const codeVerifier = cookieStore.get('google_code_verifier')?.value

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url))
  }

  try {
    const google = getGoogleClient()
    const tokens = await google.validateAuthorizationCode(code, codeVerifier)
    const accessToken = tokens.accessToken()
    const googleUser = await getGoogleUser(accessToken)

    // Check allowlist
    const allowed = getAllowedEmails()
    if (allowed.length > 0 && !allowed.includes(googleUser.email.toLowerCase())) {
      return NextResponse.redirect(new URL('/login?error=not_allowed', request.url))
    }

    // Issue JWT
    const jwt = signToken({
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.avatarUrl,
    })

    const response = NextResponse.redirect(new URL('/sessions', request.url))

    response.cookies.set('ccc_session', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
      sameSite: 'lax',
    })

    // Clean up OAuth cookies
    response.cookies.delete('google_oauth_state')
    response.cookies.delete('google_code_verifier')

    return response
  } catch (error) {
    console.error('OAuth callback error:', error)
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
  }
}
