import { cookies } from 'next/headers'
import { signToken } from '@/lib/auth/jwt'

export async function POST(request: Request) {
  const body = await request.json()
  const { password } = body

  const expectedPassword = process.env.C3_LOGIN_PASSWORD
  if (!expectedPassword) {
    return Response.json({ error: 'Password auth not configured' }, { status: 500 })
  }

  if (password !== expectedPassword) {
    return Response.json({ error: 'Wrong password' }, { status: 401 })
  }

  const token = signToken({
    email: 'chip@ideaplaces.com',
    name: 'Chip',
    avatarUrl: null,
  })

  const cookieStore = await cookies()
  cookieStore.set('ccc_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })

  return Response.json({ ok: true })
}
