import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken } from '@/lib/auth/jwt'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', request.url))
  }

  const user = verifyToken(token)
  if (!user) {
    return NextResponse.redirect(new URL('/login?error=expired', request.url))
  }

  // Issue a long-lived session token (30 days)
  const sessionToken = signToken(user)

  const cookieStore = await cookies()
  cookieStore.set('ccc_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  return NextResponse.redirect(new URL('/sessions', request.url))
}
