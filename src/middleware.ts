import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/', '/api/webhooks/']

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:8347'
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
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
