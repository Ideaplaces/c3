import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/', '/api/webhooks/', '/api/health']
const MARKETING_MODE = process.env.C3_MODE === 'marketing'

// In marketing mode, these paths are blocked (app-only routes)
const APP_PATHS = ['/sessions', '/login', '/api/auth/', '/api/sessions', '/api/projects']

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:8347'
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // In marketing mode, block app routes
  if (MARKETING_MODE) {
    const isAppRoute = APP_PATHS.some((p) => pathname === p || pathname.startsWith(p))
    if (isAppRoute) {
      const baseUrl = getBaseUrl(request)
      return NextResponse.redirect(`${baseUrl}/`)
    }
    return NextResponse.next()
  }

  // Full mode: normal auth behavior
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Marketing pages are always public
  if (pathname === '/' || pathname.startsWith('/docs') || pathname.startsWith('/features')) {
    return NextResponse.next()
  }

  const sessionToken = request.cookies.get('ccc_session')?.value
  if (!sessionToken) {
    const baseUrl = getBaseUrl(request)
    return NextResponse.redirect(`${baseUrl}/login`)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
