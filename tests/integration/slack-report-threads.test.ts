import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { manager, trigger, getSessionJSONLPath } = vi.hoisted(() => ({
  manager: {
    getActiveSession: vi.fn(), isSessionActive: vi.fn(), getRunEvents: vi.fn(),
    startSession: vi.fn(), resumeSession: vi.fn(), on: vi.fn(), removeListener: vi.fn(),
  },
  getSessionJSONLPath: vi.fn(),
  trigger: {
    name: 'reports', channelId: 'CREPORT', threadsOnly: true, reportAgents: ['daily'],
    slackBotToken: 'report-bot', discordChannelId: 'DISCORD',
    prompt: 'reports.md', projectPath: '/project', permissionMode: 'default', model: 'm',
  },
}))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: manager }))
vi.mock('@/lib/store/sessions', () => ({ getSession: () => ({ id: 'cron-session' }) }))
vi.mock('@/lib/claude-sessions/scanner', () => ({ getSessionJSONLPath }))
vi.mock('@/lib/triggers/config', () => ({
  getSlackTrigger: () => trigger, getSlackTriggerByName: () => trigger,
  loadPromptTemplate: () => 'Composed thread',
}))
vi.mock('@/lib/usage', () => ({ recordSkippedRun: vi.fn() }))

import { POST as postReport } from '@/app/api/webhooks/slack-report/route'
import { POST as postReply } from '@/app/api/webhooks/slack/route'
import { sessionForThread } from '@/lib/webhooks/discord-threads'
import { pollChannel } from '../../slack-poller'

const baseUrl = 'https://c3-other-business.test'
const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }
const request = (route: string, body: object) => new Request(`${baseUrl}/api/webhooks/${route}`, {
  method: 'POST', headers, body: JSON.stringify(body),
})

describe('Slack report and reply flow', () => {
  let events: EventEmitter

  beforeEach(() => {
    vi.resetAllMocks()
    const dir = mkdtempSync(join(tmpdir(), 'c3-report-flow-'))
    vi.stubEnv('C3_CONFIG_DIR', dir)
    vi.stubEnv('C3_DISCORD_THREADS_FILE', join(dir, 'threads.json'))
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'secret')
    vi.stubEnv('C3_BASE_URL', baseUrl)
    vi.stubEnv('CCC_URL', baseUrl)
    vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-bot')
    vi.stubEnv('SLACK_BOT_TOKEN', 'other-workspace-bot')
    events = new EventEmitter()
    manager.on.mockImplementation(events.on.bind(events))
    manager.removeListener.mockImplementation(events.removeListener.bind(events))
    manager.getActiveSession.mockReturnValue({ label: 'cron:daily' })
    manager.isSessionActive.mockReturnValue(false)
    getSessionJSONLPath.mockReturnValue('/transcript.jsonl')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('starts and links a session for an unlinked Slack reply', async () => {
    manager.startSession.mockImplementation(async ({ sessionId }) => sessionId)
    const response = await postReply(request('slack', {
      channelId: 'CREPORT', threadTs: '1.000001', messageTs: '2.000001',
      message: 'Composed thread', author: 'Chip', followUp: 'What happened?',
    }))
    const sessionId = manager.startSession.mock.calls[0][0].sessionId
    expect(await response.json()).toMatchObject({ status: 'started', sessionId })
    expect(manager.resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('slack:CREPORT:1.000001')).toMatchObject({ sessionId, trigger: 'reports' })
  })

  it('posts a report, polls a human reply, and delivers the resumed cron session answer in that thread', async () => {
    const now = Math.floor(Date.now() / 1000)
    const threadTs = `${now - 2}.000001`
    const replyTs = `${now - 1}.000001`
    const permalink = `https://workspace.slack.com/archives/CREPORT/p${threadTs.replace('.', '')}`
    const messages: { channel: string; thread_ts?: string; text: string }[] = []
    const parent = { ts: threadTs, bot_id: 'B1', latest_reply: replyTs, text: 'Daily report' }
    const reply = { ts: replyTs, thread_ts: threadTs, user: 'U1', text: 'How many passed?' }
    const replyRequest = () => request('slack', {
      channelId: 'CREPORT', threadTs, messageTs: replyTs, message: reply.text, followUp: reply.text,
    })
    let recordAnswer!: () => void
    const answerPosted = new Promise<void>(resolve => { recordAnswer = resolve })
    const react = vi.fn()
    let rateLimited = false
    const http = vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      if (url.origin === baseUrl && url.pathname === '/api/webhooks/slack') return postReply(req)
      expect(url.origin).toBe('https://slack.com')
      expect(req.headers.get('authorization')).toBe('Bearer report-bot')
      switch (url.pathname) {
        case '/api/chat.postMessage': {
          const posted = await req.json()
          if (posted.text.includes('*Five*') && !rateLimited) {
            rateLimited = true
            return Response.json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'Retry-After': '0' } })
          }
          messages.push(posted)
          if (messages.length === 2) {
            expect(sessionForThread(`slack:CREPORT:${threadTs}`)?.sessionId).toBe('cron-session')
            expect((await postReply(replyRequest())).status).toBe(409)
          }
          if (messages.length === 3) recordAnswer()
          return Response.json({ ok: true, ts: threadTs })
        }
        case '/api/chat.getPermalink': return Response.json({ ok: true, permalink })
        case '/api/auth.test': return Response.json({ ok: true, user_id: 'UBOT' })
        case '/api/conversations.history': return Response.json({ ok: true, messages: [parent] })
        case '/api/conversations.replies': return Response.json({ ok: true, messages: [parent, reply] })
        case '/api/users.info': return Response.json({ ok: true, user: { real_name: 'Chip' } })
        case '/api/reactions.add':
          react(await req.json())
          return Response.json({ ok: true })
        default: throw new Error(`Unexpected URL ${url.href}`)
      }
    })
    vi.stubGlobal('fetch', http)

    const report = await postReport(request('slack-report', {
      trigger: 'reports', sessionId: 'cron-session', head: `**Daily report** ${baseUrl}/sessions/cron-session`,
      body: `Review [the session](${baseUrl}/sessions/cron-session) when ready.\n\n[Operations status](https://status.example/hosts/c3.ideaplaces.com)`,
      idempotencyKey: 'daily:1',
    }))
    expect(await report.json()).toEqual({ ts: threadTs, permalink })

    const state = { lastTs: {} }
    manager.isSessionActive.mockReturnValue(true)
    getSessionJSONLPath.mockReturnValue(null)
    await pollChannel(trigger, state, vi.fn())
    expect(manager.startSession).not.toHaveBeenCalled()
    expect(manager.resumeSession).not.toHaveBeenCalled()
    expect(react).not.toHaveBeenCalled()

    manager.isSessionActive.mockReturnValue(false)
    getSessionJSONLPath.mockReturnValue('/transcript.jsonl')
    await pollChannel(trigger, state, vi.fn())
    expect(manager.startSession).not.toHaveBeenCalled()
    expect(manager.resumeSession).toHaveBeenCalledExactlyOnceWith('cron-session', expect.stringContaining('Chip replied in the Slack thread:'), {
      label: 'slack:reports', maxDurationMs: undefined, model: 'm',
    })
    expect(manager.resumeSession.mock.calls[0][1]).toContain('<message>\nHow many passed?\n</message>')
    expect(react).toHaveBeenCalledExactlyOnceWith({ channel: 'CREPORT', timestamp: replyTs, name: 'eyes' })
    expect(await (await postReply(replyRequest())).json()).toMatchObject({ status: 'resumed', sessionId: 'cron-session' })
    expect(manager.resumeSession).toHaveBeenCalledOnce()

    manager.getRunEvents.mockReturnValue([{ message: { type: 'assistant', message: { content: [
      { type: 'text', text: '**Five** passed. c3.ideaplaces.com/sessions/cron-session' },
    ] } } }])
    events.emit('session_ended', 'cron-session', 'completed')
    await answerPosted
    expect(rateLimited).toBe(true)
    expect(messages.map(message => ({ ...message, text: message.text.replaceAll('\u200b', '') }))).toMatchObject([
      { channel: 'CREPORT', text: '*Daily report*' },
      { channel: 'CREPORT', thread_ts: threadTs, text: 'Review the session when ready.\n\nOperations status' },
      { channel: 'CREPORT', thread_ts: threadTs, text: '*Five* passed.' },
    ])
    expect(messages[0].thread_ts).toBeUndefined()
    expect(JSON.stringify(messages)).not.toContain(baseUrl)
    expect(JSON.stringify(messages)).not.toContain('c3.ideaplaces.com')
  })
})
