import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/', '/api/webhooks/']
const isDev = process.env.NODE_ENV !== 'production'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('ccc_session')?.value
  if (!sessionToken) {
    // In development, auto-login instead of showing login page
    if (isDev) {
      return NextResponse.redirect(new URL('/api/auth/dev-login', request.url))
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
