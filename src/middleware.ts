import { NextRequest, NextResponse } from 'next/server'

// '/ws' is public here because the WebSocket endpoint runs its own JWT check
// (server.ts verifies the token query param before the upgrade completes).
// Next 15 runs middleware on upgrade requests too; without this entry a
// client that carries no ccc_session cookie gets a 307 written into a socket
// the ws server has already upgraded, which the client sees as a corrupt
// frame (RSV1 must be clear) and the connection dies at the handshake.
const PUBLIC_PATHS = ['/login', '/api/auth/', '/api/webhooks/', '/api/health', '/api/client-log', '/api/catalog', '/ws']
const MARKETING_MODE = process.env.C3_MODE === 'marketing'

const APP_PATHS = ['/sessions', '/login', '/api/auth/', '/api/sessions', '/api/projects']

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:8347'
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (MARKETING_MODE) {
    const isAppRoute = APP_PATHS.some((p) => pathname === p || pathname.startsWith(p))
    if (isAppRoute) {
      const baseUrl = getBaseUrl(request)
      return NextResponse.redirect(`${baseUrl}/`)
    }
    return NextResponse.next()
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next()
  }

  if (pathname === '/' || pathname.startsWith('/docs') || pathname.startsWith('/features')) {
    return NextResponse.next()
  }

  const sessionToken = request.cookies.get('ccc_session')?.value
  if (!sessionToken) {
    const baseUrl = getBaseUrl(request)
    const returnTo = encodeURIComponent(pathname)
    return NextResponse.redirect(`${baseUrl}/login?returnTo=${returnTo}`)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
