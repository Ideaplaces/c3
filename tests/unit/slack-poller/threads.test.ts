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
      const url = new URL(request.url)
      switch (url.pathname) {
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies':
          expect(request.headers.get('authorization')).toBe('Bearer thread-reader')
          expect(url.searchParams.get('ts')).toBe(parentTs)
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

  it('prunes the poll ledger at 14 days and skips empty replies', async () => {
    const now = Math.floor(Date.now() / 1000)
    const justOld = String(now - 14 * 86400 - 1)
    const justNew = String(now - 14 * 86400 + 1)
    const replyTs = String(now - 1)
    const parent = { ts: justNew, bot_id: 'B1', latest_reply: replyTs, text: 'report' }
    const empty = { ts: replyTs, thread_ts: parent.ts, user: 'U1', text: '   ' }
    const state = { lastTs: {}, lastReplySeen: { CREPORT: { [justOld]: 'old', [justNew]: 'previous' } } }
    fetchHttp.mockImplementation(async input => {
      switch (new URL(String(input)).pathname) {
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies': return Response.json({ ok: true, messages: [parent, empty] })
        case '/api/auth.test': return Response.json({ ok: true, user_id: 'UBOT' })
        default: throw new Error(`Unexpected URL ${input}`)
      }
    })
    const persist = vi.fn()
    await pollChannel(trigger, state, persist)
    expect(state.lastReplySeen.CREPORT).toEqual({ [justNew]: replyTs })
    expect(persist).toHaveBeenCalledOnce()
    expect(fetchHttp.mock.calls.map(([url]) => String(url)).join()).not.toContain('/api/webhooks/slack')
  })

  it('keeps polling when Slack omits the parent latest_reply from the replies response', async () => {
    const now = Math.floor(Date.now() / 1000)
    const ts = String(now - 2)
    const parent = { ts, bot_id: 'B1', latest_reply: String(now - 1), text: 'report' }
    fetchHttp.mockImplementation(async input => {
      switch (new URL(String(input)).pathname) {
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies': return Response.json({ ok: true, messages: [parent] })
        case '/api/auth.test': return Response.json({ ok: true, user_id: 'UBOT' })
        default: throw new Error(`Unexpected URL ${input}`)
      }
    })
    const state = { lastTs: {}, lastReplySeen: { CREPORT: {} } }
    const persist = vi.fn()
    await pollChannel(trigger, state, persist)
    await pollChannel(trigger, state, persist)
    expect(state.lastReplySeen.CREPORT).toEqual({})
    expect(persist).not.toHaveBeenCalled()
    expect(fetchHttp.mock.calls.filter(([url]) => String(url).includes('conversations.replies'))).toHaveLength(2)
  })

  it.each(['Slack error', 'network error'])('forwards file replies and keeps going after a reaction %s', async reactionFailure => {
    const now = Math.floor(Date.now() / 1000)
    const ts = String(now - 3)
    const first = { ts: String(now - 2), thread_ts: ts, user: 'U1', text: 'first' }
    const last = {
      ts: String(now - 1), thread_ts: ts, user: 'U1', subtype: 'file_share', text: '',
      files: [{ name: 'report.csv' }, { permalink: 'https://workspace.slack.com/files/1' }],
    }
    const parent = { ts, bot_id: 'B1', latest_reply: last.ts, text: 'report' }
    const forwarded = vi.fn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchHttp.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      switch (new URL(request.url).pathname) {
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies': return Response.json({ ok: true, messages: [parent, last, first] })
        case '/api/auth.test': return Response.json({ ok: true, user_id: 'UBOT' })
        case '/api/users.info': return Response.json({ ok: true, user: { real_name: 'Chip' } })
        case '/api/webhooks/slack':
          forwarded(await request.json())
          return Response.json({ status: 'started', sessionId: 'S1' })
        case '/api/reactions.add': {
          const { timestamp } = await request.json()
          if (timestamp === last.ts) return Response.json({ ok: true })
          if (reactionFailure === 'network error') throw new Error('connection lost')
          return Response.json({ ok: false, error: 'not_in_channel' })
        }
        default: throw new Error(`Unexpected URL ${request.url}`)
      }
    })
    try {
      const state = { lastTs: {}, lastReplySeen: { CREPORT: {} } }
      await pollChannel(trigger, state, vi.fn())
      expect(forwarded.mock.calls.map(([payload]) => payload.messageTs)).toEqual([first.ts, last.ts])
      expect(forwarded.mock.lastCall?.[0]).toMatchObject({
        followUp: '(Chip attached a file: report.csv)\n(Chip attached a file: https://workspace.slack.com/files/1)',
        message: expect.stringContaining('Chip attached a file: report.csv'),
      })
      expect(state.lastReplySeen.CREPORT).toEqual({ [ts]: last.ts })
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })
})
