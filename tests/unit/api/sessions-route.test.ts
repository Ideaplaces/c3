import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const listSessions = vi.fn((_opts: { scope: string; limit: number }) => [])
vi.mock('@/lib/store/sessions', () => ({ listSessions: (opts: { scope: string; limit: number }) => listSessions(opts) }))

import { GET } from '@/app/api/sessions/route'

const call = (query: string) => GET(new NextRequest(`http://localhost/api/sessions${query}`))

describe('GET /api/sessions', () => {
  beforeEach(() => listSessions.mockClear())

  it.each([
    ['', { scope: 'web', limit: 50 }],
    ['?scope=all&limit=10', { scope: 'all', limit: 10 }],
    ['?scope=bogus&limit=5000', { scope: 'web', limit: 200 }],
    ['?limit=0', { scope: 'web', limit: 50 }],
    ['?limit=-3', { scope: 'web', limit: 50 }],
    ['?limit=2.5', { scope: 'web', limit: 50 }],
  ])('%s asks the store for %o', async (query, expected) => {
    await call(query)
    expect(listSessions).toHaveBeenCalledWith(expected)
  })
})
