import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mirrorPostToInbox } = vi.hoisted(() => ({ mirrorPostToInbox: vi.fn() }))
vi.mock('@/lib/inbox/discord', () => ({ mirrorPostToInbox }))

import { POST } from '@/app/api/webhooks/inbox/route'

function call(body: unknown, auth = 'Bearer s3cret') {
  return POST(new Request('http://localhost/api/webhooks/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

const valid = { sourceChannelId: 'C1', sourceMessageId: 'M1', text: 'Needs from you: merge #12?', agent: 'cron:x', sessionId: 'S1' }

describe('POST /api/webhooks/inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CCC_WEBHOOK_SECRET = 's3cret'
    mirrorPostToInbox.mockResolvedValue({ status: 'posted', inboxMessageId: 'L1' })
  })

  it('refuses a caller without the secret', async () => {
    expect((await call(valid, 'Bearer nope')).status).toBe(401)
    expect(mirrorPostToInbox).not.toHaveBeenCalled()
  })

  it('refuses everyone when the server has no secret configured', async () => {
    delete process.env.CCC_WEBHOOK_SECRET
    expect((await call(valid, 'Bearer undefined')).status).toBe(401)
  })

  it('refuses a body that is not JSON or misses the source or the text', async () => {
    expect((await call('not json')).status).toBe(400)
    expect((await call({ ...valid, text: '' })).status).toBe(400)
    expect((await call({ ...valid, sourceMessageId: undefined })).status).toBe(400)
  })

  it('hands the post to the inbox and returns its result', async () => {
    const res = await call(valid)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'posted', inboxMessageId: 'L1' })
    expect(mirrorPostToInbox).toHaveBeenCalledWith({ ...valid, sourceThreadId: undefined })
  })

  it('answers 502 when the line could not be posted, so the poster keeps it in its outbox', async () => {
    mirrorPostToInbox.mockResolvedValue({ status: 'failed', reason: 'Discord refused the inbox line' })
    expect((await call(valid)).status).toBe(502)
  })
})
