import { generateCodeVerifier, generateState } from 'arctic'
import { getGoogleClient } from '@/lib/auth/google'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const google = getGoogleClient()
  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  const scopes = ['openid', 'profile', 'email']
  const authUrl = google.createAuthorizationURL(state, codeVerifier, scopes)

  const cookieStore = await cookies()

  cookieStore.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
    sameSite: 'lax',
  })

  cookieStore.set('google_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
    sameSite: 'lax',
  })

  return NextResponse.redirect(authUrl)
}
