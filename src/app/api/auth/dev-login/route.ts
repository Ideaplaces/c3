import { NextResponse } from 'next/server'
import { signToken } from '@/lib/auth/jwt'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const jwt = signToken({
    email: 'dev@localhost',
    name: 'Dev User',
    avatarUrl: null,
  })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8347'
  const response = NextResponse.redirect(new URL('/sessions', baseUrl))

  response.cookies.set('ccc_session', jwt, {
    httpOnly: true,
    secure: false,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
  })

  return response
}
