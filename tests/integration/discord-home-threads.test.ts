import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { manager, getSession, gatewayListeners, sendToThread, callbackServer } = vi.hoisted(() => ({
  manager: {
    getActiveSession: vi.fn(), isSessionActive: vi.fn(), runningSessionWithLabel: vi.fn(),
    getRunEvents: vi.fn(), getBufferedEvents: vi.fn(), startSession: vi.fn(), resumeSession: vi.fn(), on: vi.fn(), removeListener: vi.fn(),
  },
  getSession: vi.fn(),
  gatewayListeners: new Map<string, (message: unknown) => Promise<void>>(),
  sendToThread: vi.fn(async (_message: unknown, _channelId: string) => undefined),
  callbackServer: {} as { handle: (req: unknown, res: unknown) => Promise<void> },
}))
vi.mock('discord.js', () => ({
  Client: class {
    user = { id: 'c3-bot' }
    channels = { fetch: async (id: string) => ({ isThread: () => true, send: (message: unknown) => sendToThread(message, id) }) }
    on(event: string, handler: (message: unknown) => Promise<void>) { gatewayListeners.set(event, handler) }
    login() {}
  },
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
}))
vi.mock('http', () => ({ default: {
  createServer: (handle: typeof callbackServer.handle) => {
    callbackServer.handle = handle
    return { listen() {} }
  },
} }))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: manager }))
vi.mock('@/lib/store/sessions', () => ({ getSession }))
vi.mock('@/lib/claude-sessions/scanner', () => ({ getSessionJSONLPath: () => '/transcript.jsonl' }))
vi.mock('@/lib/triggers/config', () => ({
  loadTriggersConfig: () => ({ channels: {} }),
  getChannelTrigger: () => null,
  getCronTrigger: () => ({ model: 'cron-model', maxDurationMs: 2000, projectPath: '/configured-checkout' }),
  getSlackTrigger: () => ({ name: 'alerts', projectPath: '/slack-checkout', discordChannelId: 'alerts-home' }),
  loadPromptTemplate: () => 'Investigate the alert',
}))
vi.mock('@/lib/usage', () => ({ recordSkippedRun: vi.fn() }))

import { POST as linkReport } from '@/app/api/webhooks/inbox/route'
import { POST as replyInDiscord } from '@/app/api/webhooks/discord/route'
import { POST as postSlackAlert } from '@/app/api/webhooks/slack/route'
import { BUSY_NOTE, routeMessage } from '@/lib/discord-bot/logic'
import { nonceFor } from '@/lib/webhooks/discord-mirror'
import { linkThread, sessionForThread } from '@/lib/webhooks/discord-threads'

const baseUrl = 'https://c3.test'
const request = (route: string, body: object) => new Request(`${baseUrl}/api/webhooks/${route}`, {
  method: 'POST',
  headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const gatewayMessage = (id: string, channelId: string, parentId: string) => ({
  id, channelId, channel: { id: channelId, parentId, isThread: () => true },
  author: { id: 'chip', username: 'Chip', bot: false }, content: 'How many passed?',
  system: false, embeds: [], attachments: new Map(), mentions: { users: new Map() }, react: vi.fn(),
})

describe('Discord home report and reply flow', () => {
  let events: EventEmitter

  beforeEach(() => {
    vi.resetAllMocks()
    const dir = mkdtempSync(join(tmpdir(), 'c3-home-flow-'))
    vi.stubEnv('C3_CONFIG_DIR', dir)
    vi.stubEnv('C3_DISCORD_THREADS_FILE', join(dir, 'threads.json'))
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'secret')
    vi.stubEnv('C3_BASE_URL', baseUrl)
    vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-bot')
    vi.stubEnv('SLACK_BOT_TOKEN', undefined)
    events = new EventEmitter()
    manager.on.mockImplementation(events.on.bind(events))
    manager.removeListener.mockImplementation(events.removeListener.bind(events))
    manager.getActiveSession.mockReturnValue({ label: 'cron:daily' })
    getSession.mockReturnValue({ source: 'cron:daily', projectPath: '/original-worktree' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('links a cron report, resumes on a human reply, and posts exactly one answer in its thread', async () => {
    const homeChannelId = 'home-channel'
    const reportMessageId = 'report-message'
    const sessionId = 'cron-session'
    const callbackUrl = 'http://localhost:8348/callback'
    const delivery: { content: string; enforce_nonce?: boolean }[] = []
    let recordCallback!: (body: unknown) => void
    const callbackReceived = new Promise<unknown>(resolve => { recordCallback = resolve })
    const discord = vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init)
      if (req.url === callbackUrl) {
        recordCallback(await req.json())
        return Response.json({ ok: true })
      }
      expect(req.url).toBe(`https://discord.com/api/v10/channels/${reportMessageId}/messages`)
      expect(req.headers.get('authorization')).toBe('Bot discord-bot')
      delivery.push(await req.json())
      return Response.json({ id: 'answer-message' })
    })
    vi.stubGlobal('fetch', discord)

    const report = await linkReport(request('inbox', {
      sourceChannelId: homeChannelId, sourceMessageId: reportMessageId,
      text: 'Daily report', agent: 'cron:daily', sessionId,
    }))
    expect(await report.json()).toEqual({ status: 'linked' })

    manager.getActiveSession.mockReturnValue(undefined)
    const route = routeMessage([], {
      channelId: reportMessageId, parentId: homeChannelId, isThread: true,
      isSelf: false, isSystem: false, authorIsBot: false,
    })
    expect(route).toEqual({ kind: 'home' })
    const reply = () => request('discord', {
      channelId: homeChannelId, threadId: reportMessageId, messageId: 'human-reply',
      author: 'Chip', homeThread: route.kind === 'home', followUp: 'How many passed?', callbackUrl,
    })
    const response = await replyInDiscord(reply())
    expect(await response.json()).toMatchObject({ status: 'resumed', sessionId })
    expect(manager.resumeSession).toHaveBeenCalledExactlyOnceWith(sessionId, expect.stringContaining('<message>\nHow many passed?\n</message>'), {
      label: 'cron:daily', model: 'cron-model', maxDurationMs: 2000,
    })
    expect(manager.startSession).not.toHaveBeenCalled()

    manager.getRunEvents.mockReturnValue([{ message: { type: 'assistant', message: { content: 'Five passed.' } } }])
    events.emit('session_ended', sessionId, 'completed')
    expect(await callbackReceived).toMatchObject({ sessionId, replied: true, summary: 'Five passed.' })
    expect(delivery).toEqual([expect.objectContaining({
      content: expect.stringContaining('Five passed.'), enforce_nonce: true,
    })])
    expect(delivery[0].content).toContain(`cd /original-worktree && claude --resume ${sessionId}`)
    expect(await (await replyInDiscord(reply())).json()).toEqual({ status: 'already' })
    events.emit('session_ended', sessionId, 'completed')
    expect(manager.resumeSession).toHaveBeenCalledOnce()
    expect(discord).toHaveBeenCalledTimes(2)
    expect(delivery).toHaveLength(1)
  })

  it('links a Slack investigation report by its own Discord message ID', async () => {
    const sent: { content: string; message_reference?: { message_id: string } }[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init)
      expect(req.url).toBe('https://discord.com/api/v10/channels/alerts-home/messages')
      sent.push(await req.json())
      return Response.json({ id: sent.length === 1 ? 'alert-message' : 'investigation-report' })
    }))
    manager.getActiveSession.mockReturnValue(undefined)
    getSession.mockReturnValue(undefined)
    manager.getBufferedEvents.mockReturnValue([{ message: { type: 'assistant', message: { content: 'The queue recovered.' } } }])

    const response = await postSlackAlert(request('slack', { channelId: 'slack-channel', message: 'Queue stalled' }))
    expect(response.status).toBe(200)
    const { sessionId } = await response.json()
    await Promise.all(events.listeners('session_ended').map(listener => listener(sessionId, 'completed')))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ content: expect.stringContaining('The queue recovered.'), message_reference: { message_id: 'alert-message' } })
    expect(sessionForThread('alert-message')).toBeNull()
    expect(sessionForThread('investigation-report')).toMatchObject({ sessionId, trigger: 'slack:alerts' })
  })

  it('routes gateway replies past a pinned trigger and leaves ignored replies untouched', async () => {
    const homeChannelId = 'report-channel'
    const threadId = 'direct-report-thread'
    const sessionId = 'cron-session'
    vi.stubEnv('CCC_URL', baseUrl)
    vi.stubEnv('C3_DISCORD_BOT', 'default')
    vi.stubEnv('C3_DISCORD_BOT_TOKEN_ENV', 'DISCORD_BOT_TOKEN')
    writeFileSync(join(process.env.C3_CONFIG_DIR!, 'triggers.json'), JSON.stringify({
      channels: { pinned: { name: 'pinned', channelId: threadId, webhookId: 'webhook-only' } },
    }))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init)
      expect(req.url).toBe(`${baseUrl}/api/webhooks/discord`)
      return replyInDiscord(req)
    }))
    vi.resetModules()
    await import('../../discord-bot')
    const receive = gatewayListeners.get('messageCreate')!
    const ignored = gatewayMessage('unlinked-reply', 'unlinked-thread', homeChannelId)
    await receive(ignored)
    expect(ignored.react).not.toHaveBeenCalled()
    expect(sendToThread).not.toHaveBeenCalled()
    expect(manager.resumeSession).not.toHaveBeenCalled()

    const report = await linkReport(request('inbox', {
      sourceChannelId: homeChannelId, sourceMessageId: threadId, text: 'Daily report', sessionId,
    }))
    expect(await report.json()).toEqual({ status: 'linked' })
    manager.isSessionActive.mockReturnValueOnce(true)
    const busy = gatewayMessage('busy-reply', threadId, homeChannelId)
    await receive(busy)
    expect(sendToThread).toHaveBeenCalledExactlyOnceWith(BUSY_NOTE, threadId)
    expect(busy.react).not.toHaveBeenCalled()

    const accepted = gatewayMessage('accepted-reply', threadId, homeChannelId)
    await receive(accepted)
    expect(manager.startSession).not.toHaveBeenCalled()
    expect(manager.resumeSession).toHaveBeenCalledExactlyOnceWith(sessionId, expect.stringContaining('How many passed?'), {
      label: 'cron:daily', model: 'cron-model', maxDurationMs: 2000,
    })
    expect(accepted.react).toHaveBeenCalledExactlyOnceWith('👀')
  })

  it('reuses each server answer nonce when the gateway retries in the original report thread', async () => {
    const sessionId = 'shared-session'
    linkThread('thread-a', sessionId, 'cron:daily')
    linkThread('thread-b', sessionId, 'cron:daily')
    vi.stubEnv('CCC_URL', baseUrl)
    vi.stubEnv('C3_DISCORD_BOT', 'default')
    vi.stubEnv('C3_DISCORD_BOT_TOKEN_ENV', 'C3_TEST_BOT_TOKEN')
    vi.stubEnv('C3_TEST_BOT_TOKEN', 'discord-gateway')
    writeFileSync(join(process.env.C3_CONFIG_DIR!, 'triggers.json'), JSON.stringify({
      channels: { direct: { name: 'direct', channelId: 'thread-b', thread: true } },
    }))
    const answerAttempts: { channelId: string; nonce: string; enforce_nonce: boolean }[] = []
    const callbacks: string[] = []
    let callbackArrived: () => void
    const network = vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init)
      if (req.url === `${baseUrl}/api/webhooks/discord`) return replyInDiscord(req)
      const url = new URL(req.url)
      if (url.hostname === 'discord.com') {
        const channelId = url.pathname.split('/')[4]
        const { nonce, enforce_nonce } = await req.json()
        answerAttempts.push({ channelId, nonce, enforce_nonce })
        return new Response(null, { status: 403 })
      }
      expect(url.pathname).toBe('/callback')
      callbacks.push(await req.text())
      callbackArrived()
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', network)
    vi.resetModules()
    await import('../../discord-bot')
    const receive = gatewayListeners.get('messageCreate')!
    const blank = { ...gatewayMessage('blank-reply', 'thread-a', 'home-channel'), content: ' \t\n ' }
    await receive(blank)
    expect(network).not.toHaveBeenCalled()
    expect(blank.react).not.toHaveBeenCalled()

    for (const [threadId, messageId, answer] of [
      ['thread-a', 'reply-a', 'Answer for A'], ['thread-b', 'reply-b', 'Answer for B'],
    ]) {
      const message = {
        ...gatewayMessage(messageId, threadId, 'home-channel'),
        ...(threadId === 'thread-b' ? { thread: { id: 'nested-thread' } } : {}),
      }
      await receive(message)
      expect(message.react).toHaveBeenCalledOnce()
      manager.getRunEvents.mockReturnValue([{ message: { type: 'assistant', message: { content: answer } } }])
      const posted = new Promise<void>(resolve => { callbackArrived = resolve })
      events.emit('session_ended', sessionId, 'completed')
      await posted
    }

    expect(callbacks).toHaveLength(2)
    for (const body of callbacks) {
      const req = Object.assign(new EventEmitter(), { method: 'POST', url: '/callback' })
      const res = { writeHead: vi.fn(), end: vi.fn() }
      const handled = callbackServer.handle(req, res)
      req.emit('data', Buffer.from(body))
      req.emit('end')
      await handled
      expect(res.writeHead).toHaveBeenCalledWith(200)
    }
    expect(answerAttempts).toEqual([
      { channelId: 'thread-a', nonce: nonceFor(`${sessionId}:reply-a`), enforce_nonce: true },
      { channelId: 'thread-b', nonce: nonceFor(`${sessionId}:reply-b`), enforce_nonce: true },
    ])
    expect(sendToThread.mock.calls).toEqual([
      [expect.objectContaining({ content: expect.stringContaining('Answer for A'), nonce: answerAttempts[0].nonce, enforceNonce: true }), 'thread-a'],
      [expect.objectContaining({ content: expect.stringContaining('Answer for B'), nonce: answerAttempts[1].nonce, enforceNonce: true }), 'thread-b'],
    ])
  })
})
