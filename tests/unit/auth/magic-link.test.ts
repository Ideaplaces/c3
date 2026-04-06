import { describe, it, expect } from 'vitest'

/**
 * Tests for the magic link auth flow logic.
 * These test the pure logic extracted from the route handlers.
 */

describe('returnTo parameter', () => {
  function sanitizeReturnTo(returnTo: string | null | undefined): string {
    if (!returnTo || typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
      return '/sessions'
    }
    return returnTo
  }

  it('defaults to /sessions when returnTo is missing', () => {
    expect(sanitizeReturnTo(null)).toBe('/sessions')
    expect(sanitizeReturnTo(undefined)).toBe('/sessions')
    expect(sanitizeReturnTo('')).toBe('/sessions')
  })

  it('accepts valid relative paths', () => {
    expect(sanitizeReturnTo('/sessions/abc-123')).toBe('/sessions/abc-123')
    expect(sanitizeReturnTo('/sessions')).toBe('/sessions')
  })

  it('rejects absolute URLs (open redirect prevention)', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBe('/sessions')
    expect(sanitizeReturnTo('http://evil.com/sessions')).toBe('/sessions')
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeReturnTo('//evil.com')).toBe('/sessions')
  })

  it('preserves path with query params', () => {
    expect(sanitizeReturnTo('/sessions/abc?tab=tools')).toBe('/sessions/abc?tab=tools')
  })
})

describe('magic link dedup', () => {
  function shouldSendEmail(lastSentAt: number, now: number, windowMs: number): boolean {
    return now - lastSentAt >= windowMs
  }

  const WINDOW = 10_000

  it('allows first send', () => {
    expect(shouldSendEmail(0, Date.now(), WINDOW)).toBe(true)
  })

  it('blocks duplicate within window', () => {
    const now = Date.now()
    expect(shouldSendEmail(now - 1000, now, WINDOW)).toBe(false)
  })

  it('allows send after window expires', () => {
    const now = Date.now()
    expect(shouldSendEmail(now - 11_000, now, WINDOW)).toBe(true)
  })

  it('blocks at exact boundary', () => {
    const now = Date.now()
    expect(shouldSendEmail(now - WINDOW + 1, now, WINDOW)).toBe(false)
  })

  it('allows at exact boundary', () => {
    const now = Date.now()
    expect(shouldSendEmail(now - WINDOW, now, WINDOW)).toBe(true)
  })
})

describe('login redirect flow', () => {
  function buildLoginUrl(baseUrl: string, pathname: string): string {
    const returnTo = encodeURIComponent(pathname)
    return `${baseUrl}/login?returnTo=${returnTo}`
  }

  it('encodes session path in login URL', () => {
    const url = buildLoginUrl('https://c3.example.com', '/sessions/abc-123')
    expect(url).toBe('https://c3.example.com/login?returnTo=%2Fsessions%2Fabc-123')
  })

  it('encodes root path', () => {
    const url = buildLoginUrl('https://c3.example.com', '/sessions')
    expect(url).toContain('returnTo=%2Fsessions')
  })

  function buildMagicUrl(baseUrl: string, token: string, returnTo: string): string {
    return `${baseUrl}/api/auth/magic-link/verify?token=${token}&returnTo=${encodeURIComponent(returnTo)}`
  }

  it('embeds returnTo in magic link URL', () => {
    const url = buildMagicUrl('https://c3.example.com', 'jwt-token', '/sessions/abc-123')
    expect(url).toContain('returnTo=%2Fsessions%2Fabc-123')
    expect(url).toContain('token=jwt-token')
  })
})
