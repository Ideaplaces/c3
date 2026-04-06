import { describe, it, expect } from 'vitest'
import { sanitizeReturnTo, DEFAULT_RETURN_PATH } from '@/lib/auth/return-to'

describe('sanitizeReturnTo', () => {
  it('defaults to /sessions when returnTo is missing', () => {
    expect(sanitizeReturnTo(null)).toBe(DEFAULT_RETURN_PATH)
    expect(sanitizeReturnTo(undefined)).toBe(DEFAULT_RETURN_PATH)
    expect(sanitizeReturnTo('')).toBe(DEFAULT_RETURN_PATH)
  })

  it('accepts valid relative paths', () => {
    expect(sanitizeReturnTo('/sessions/abc-123')).toBe('/sessions/abc-123')
    expect(sanitizeReturnTo('/sessions')).toBe('/sessions')
  })

  it('rejects absolute URLs (open redirect prevention)', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBe(DEFAULT_RETURN_PATH)
    expect(sanitizeReturnTo('http://evil.com/sessions')).toBe(DEFAULT_RETURN_PATH)
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeReturnTo('//evil.com')).toBe(DEFAULT_RETURN_PATH)
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
})
