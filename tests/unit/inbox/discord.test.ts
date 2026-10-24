import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { discordInboxDeps } from '@/lib/inbox/discord'

let calls: { url: string; body?: Record<string, unknown> }[]
let reply: (url: string) => Response
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  globalThis.fetch = vi.fn(async (u: unknown, init?: { body?: string }) => {
    calls.push({ url: String(u), body: init?.body ? JSON.parse(init.body) : undefined })
    return reply(String(u))
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('discordInboxDeps', () => {
  it('posts the inbox line with its nonce enforced', async () => {
    reply = () => new Response(JSON.stringify({ id: 'L1' }))
    expect(await discordInboxDeps('tok').post('INBOX', 'line', 'nc1')).toBe('L1')
    expect(calls[0].body).toMatchObject({ content: 'line', nonce: 'nc1', enforce_nonce: true })
  })

  it('counts a thread that already exists as opened, so a retry does not fail on it', async () => {
    reply = () => new Response(JSON.stringify({ code: 160004 }), { status: 400 })
    expect(await discordInboxDeps('tok').openThread('INBOX', 'L1', 'name')).toBe(true)
  })

  it('reports any other refusal to open the thread', async () => {
    reply = () => new Response(JSON.stringify({ code: 50013 }), { status: 403 })
    expect(await discordInboxDeps('tok').openThread('INBOX', 'L1', 'name')).toBe(false)
  })

  it('names a channel once and falls back to its id when Discord will not say', async () => {
    reply = () => new Response(JSON.stringify({ name: 'plusgrade' }))
    const deps = discordInboxDeps('tok')
    expect(await deps.channelName('C77')).toBe('plusgrade')
    expect(await deps.channelName('C77')).toBe('plusgrade')
    expect(calls.filter(c => c.url.endsWith('/channels/C77'))).toHaveLength(1)
    reply = () => new Response('{}', { status: 404 })
    expect(await deps.channelName('C78')).toBe('C78')
  })
})

describe('mirrorPostToInbox', () => {
  it('never throws at the caller whose report already landed', async () => {
    vi.resetModules()
    vi.doMock('@/lib/inbox/config', () => ({ getInboxConfig: () => { throw new Error('triggers.json unreadable') } }))
    const { mirrorPostToInbox } = await import('@/lib/inbox/discord')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await mirrorPostToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: 'Needs from you: x?' }))
        .toEqual({ status: 'failed', reason: 'Error: triggers.json unreadable' })
    } finally {
      logged.mockRestore()
      vi.doUnmock('@/lib/inbox/config')
    }
  })
})
