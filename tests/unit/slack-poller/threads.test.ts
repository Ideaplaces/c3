import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollChannel } from '../../../slack-poller'
import type { SlackTrigger } from '@/lib/triggers/config'

const trigger: SlackTrigger = {
  name: 'reports', channelId: 'CREPORT', threadsOnly: true, slackBotToken: 'test-bot',
  prompt: 'report.md', projectPath: '/project', model: 'm', permissionMode: 'default',
}

describe('Slack report poller', () => {
  const fetchHttp = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchHttp)
    vi.stubEnv('CCC_URL', 'http://c3.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('never forwards top-level messages when threadsOnly is set', async () => {
    const ts = `${Math.floor(Date.now() / 1000)}.000001`
    fetchHttp.mockResolvedValueOnce(Response.json({ ok: true, messages: [
      { ts, bot_id: 'B1', text: 'report' }, { ts: `${ts}2`, user: 'U1', text: 'human top level' },
    ] }))
    await pollChannel(trigger, { lastTs: {} }, vi.fn())
    expect(fetchHttp.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/conversations.history',
    ])
  })

  it('leaves a busy reply unmarked, retries it, then skips the unchanged thread', async () => {
    const now = Math.floor(Date.now() / 1000)
    const parentTs = `${now - 3}.000001`
    const replyTs = `${now - 1}.000001`
    const parent = { ts: parentTs, bot_id: 'B1', latest_reply: replyTs, text: 'report' }
    const reply = { ts: replyTs, thread_ts: parentTs, user: 'U1', text: 'please continue' }
    const details = { ts: `${now - 2}.000001`, thread_ts: parentTs, bot_id: 'B1', text: 'report details' }
    const state = { lastTs: {} }
    const reaction = vi.fn()
    const forward = vi.fn()
      .mockReturnValueOnce(Response.json({ status: 'busy' }, { status: 409 }))
      .mockReturnValueOnce(Response.json({ status: 'resumed', sessionId: 'S1' }))
    fetchHttp.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      switch (new URL(request.url).pathname) {
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies':
          expect(request.headers.get('authorization')).toBe('Bearer thread-reader')
          return Response.json({ ok: true, messages: [parent, reply, details] })
        case '/api/auth.test': return Response.json({ ok: true, user_id: 'UBOT' })
        case '/api/users.info': return Response.json({ ok: true, user: { real_name: 'Chip' } })
        case '/api/webhooks/slack': return forward(await request.json())
        case '/api/reactions.add':
          expect(request.headers.get('authorization')).toBe('Bearer test-bot')
          reaction(await request.json())
          return Response.json({ ok: true })
        default: throw new Error(`Unexpected request ${request.url}`)
      }
    })
    const reportTrigger = { ...trigger, slackThreadReadToken: 'thread-reader' }
    await pollChannel(reportTrigger, state, vi.fn())
    expect(forward).toHaveBeenCalledOnce()
    expect(reaction).not.toHaveBeenCalled()
    await pollChannel(reportTrigger, state, vi.fn())
    await pollChannel(reportTrigger, state, vi.fn())
    expect(forward).toHaveBeenCalledTimes(2)
    expect(forward).toHaveBeenLastCalledWith(expect.objectContaining({
      threadTs: parentTs, messageTs: replyTs, followUp: reply.text, author: 'Chip',
      message: expect.stringContaining('report details'),
    }))
    expect(reaction).toHaveBeenCalledExactlyOnceWith({ channel: 'CREPORT', timestamp: replyTs, name: 'eyes' })
    expect(fetchHttp.mock.calls.filter(([input]) => String(input).includes('conversations.replies'))).toHaveLength(2)
  })
})
