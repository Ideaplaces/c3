import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Ensure we're not in marketing mode for these tests
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('C3_MODE', '')
})

function buildRequest(pathname: string, opts?: { withSession?: boolean }): NextRequest {
  const url = new URL(pathname, 'https://c3.ideaplaces.com')
  const req = new NextRequest(url)
  if (opts?.withSession) {
    req.cookies.set('ccc_session', 'test-token')
  }
  return req
}

describe('middleware public paths', () => {
  it('allows /api/catalog without authentication', async () => {
    const { middleware } = await import('@/middleware')
    const res = middleware(buildRequest('/api/catalog'))
    // NextResponse.next() has no location header; redirects do
    expect(res.headers.get('location')).toBeNull()
  })

  it('allows /api/health without authentication', async () => {
    const { middleware } = await import('@/middleware')
    const res = middleware(buildRequest('/api/health'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('allows /api/client-log without authentication', async () => {
    const { middleware } = await import('@/middleware')
    const res = middleware(buildRequest('/api/client-log'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('redirects /sessions to login without authentication', async () => {
    const { middleware } = await import('@/middleware')
    const res = middleware(buildRequest('/sessions'))
    expect(res.headers.get('location')).toContain('/login')
  })

  it('allows /sessions with valid session cookie', async () => {
    const { middleware } = await import('@/middleware')
    const res = middleware(buildRequest('/sessions', { withSession: true }))
    expect(res.headers.get('location')).toBeNull()
  })
})
