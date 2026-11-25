import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { startSession, resumeSession, isSessionActive, getSession, getChannelTrigger, getCronTrigger, getSlackTriggerByName, runningSessionWithLabel, runPrecheck, getSessionJSONLPath, sessionEvents, runEvents } = vi.hoisted(() => ({
  sessionEvents: new (require('node:events') as typeof import('node:events')).EventEmitter(),
  runEvents: { current: [] as unknown[] },
  getSessionJSONLPath: vi.fn(),
  startSession: vi.fn(),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  isSessionActive: vi.fn().mockReturnValue(false),
  getSession: vi.fn(),
  getChannelTrigger: vi.fn(),
  getCronTrigger: vi.fn(),
  getSlackTriggerByName: vi.fn(),
  runningSessionWithLabel: vi.fn(),
  runPrecheck: vi.fn(),
}))
vi.mock('@/lib/sdk/session-manager', () => ({
  sessionManager: {
    startSession,
    resumeSession,
    isSessionActive,
    runningSessionWithLabel,
    on: (e: string, fn: (...a: unknown[]) => void) => sessionEvents.on(e, fn),
    removeListener: (e: string, fn: (...a: unknown[]) => void) => sessionEvents.removeListener(e, fn),
    getRunEvents: () => runEvents.current,
  },
}))
vi.mock('@/lib/claude-sessions/scanner', () => ({ getSessionJSONLPath }))
vi.mock('@/lib/store/sessions', () => ({ getSession }))
vi.mock('@/lib/triggers/precheck', () => ({ runPrecheck }))
vi.mock('@/lib/usage', () => ({ recordSkippedRun: vi.fn() }))
vi.mock('@/lib/models', () => ({ DEFAULT_MODEL: 'test-model' }))
vi.mock('@/lib/triggers/config', () => ({ getChannelTrigger, getCronTrigger, getSlackTriggerByName, loadPromptTemplate: () => 'rendered prompt' }))

import { POST } from '@/app/api/webhooks/discord/route'
import { sessionForThread, followUpPrompt, linkThread } from '@/lib/webhooks/discord-threads'
import { resolveResumable } from '@/lib/webhooks/thread-session'

const fan = { name: 'superfan-tour-calls', channelId: 'C1', prompt: 'superfan-chat.md', projectPath: '/p', permissionMode: 'bypassPermissions', model: 'm', thread: true, maxDurationMs: 1000 }

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/webhooks/discord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ channelId: 'C1', author: 'chip', messageId: 'M1', ...body }),
  }))
}

describe('discord webhook: home-thread replies', () => {
  const reply = { channelId: 'HOME', message: 'Conversation so far', followUp: 'How many passed?', threadId: 'M0', messageId: 'R1' }
  let discord: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'test-secret')
    vi.stubEnv('C3_DISCORD_THREADS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discord-home-')), 'threads.json'))
    vi.stubEnv('C3_BASE_URL', 'https://c3.test')
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    discord = vi.fn<typeof fetch>(async () => Response.json({ id: 'NOTE' }))
    vi.stubGlobal('fetch', discord)
    getChannelTrigger.mockReturnValue(null)
    startSession.mockResolvedValue('new-session')
    isSessionActive.mockReturnValue(false)
    runningSessionWithLabel.mockReturnValue(null)
    getSession.mockReturnValue({ id: 'S1', projectPath: '/session-worktree', source: 'cron:daily' })
    getSessionJSONLPath.mockReturnValue('/transcript.jsonl')
    getCronTrigger.mockReturnValue({ model: 'cron-model', maxDurationMs: 1700, projectPath: '/cron-config' })
    getSlackTriggerByName.mockReturnValue({ model: 'slack-model', maxDurationMs: 2100, projectPath: '/slack-config' })
    sessionEvents.removeAllListeners()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    isSessionActive.mockReset()
    runningSessionWithLabel.mockReset()
    sessionEvents.removeAllListeners()
  })

  it('resumes a linked cron thread in an unconfigured channel with only the follow-up', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    const res = await post({ ...reply, homeThread: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(getChannelTrigger).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(getCronTrigger).toHaveBeenCalledExactlyOnceWith('daily')
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('S1', followUpPrompt('chip', reply.followUp), {
      label: 'cron:daily', model: 'cron-model', maxDurationMs: 1700,
    })
  })

  it('ignores an unlinked thread in an unconfigured channel', async () => {
    const res = await post(reply)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).not.toHaveBeenCalled()
    expect(discord).not.toHaveBeenCalled()
  })

  it('ignores an unlinked home fallback even in a configured channel', async () => {
    getChannelTrigger.mockReturnValue(fan)
    expect(await (await post({ ...reply, homeThread: true })).json()).toEqual({ status: 'ignored' })
    expect(startSession).not.toHaveBeenCalled()
  })

  it.each(['missing transcript', 'expired link'])('posts the original session URL and starts nothing for %s', async (reason) => {
    const linkedAt = reason === 'expired link' ? new Date(Date.now() - 31 * 86_400_000) : new Date()
    linkThread('M0', 'S1', 'cron:daily', linkedAt)
    if (reason === 'expired link') linkThread('OTHER', 'S2', 'another-trigger')
    else getSessionJSONLPath.mockReturnValue(null)
    const res = await post({ ...reply, homeThread: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'unavailable' })
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).not.toHaveBeenCalled()
    expect(discord).toHaveBeenCalledOnce()
    const [url, init] = discord.mock.calls[0]
    expect(url).toBe('https://discord.com/api/v10/channels/M0/messages')
    expect(JSON.parse(String(init?.body))).toMatchObject({ content: expect.stringContaining('https://c3.test/sessions/S1') })
  })

  it('prioritizes the cron link over a channel thread trigger and its precheck', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'skip' })
    const res = await post({ ...reply, channelId: 'C1' })
    expect(await res.json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(runPrecheck).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession.mock.calls[0][2].label).toBe('cron:daily')
  })

  it('uses the Slack trigger settings for a report posted from a Slack run', async () => {
    linkThread('M0', 'S1', 'slack:alerts')
    expect((await post({ ...reply, homeThread: true })).status).toBe(200)
    expect(getSlackTriggerByName).toHaveBeenCalledExactlyOnceWith('alerts')
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('S1', followUpPrompt('chip', reply.followUp), {
      label: 'slack:alerts', model: 'slack-model', maxDurationMs: 2100,
    })
  })

  it('returns busy if the session is active or another run owns the cron worktree', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    isSessionActive.mockReturnValueOnce(true)
    expect((await post({ ...reply, homeThread: true })).status).toBe(409)
    runningSessionWithLabel.mockReturnValueOnce('another-run')
    expect((await post({ ...reply, homeThread: true })).status).toBe(409)
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('refuses to resume if the reply receipt cannot be stored', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    fs.mkdirSync(`${process.env.C3_DISCORD_THREADS_FILE}.tmp`)
    expect((await post({ ...reply, homeThread: true })).status).toBe(502)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('refuses to resume a linked reply without a Discord message ID', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    expect((await post({ ...reply, homeThread: true, messageId: undefined })).status).toBe(400)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('never resumes a second time if confirmation of the first resume fails', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    resumeSession.mockImplementationOnce(async () => { fs.mkdirSync(`${process.env.C3_DISCORD_THREADS_FILE}.tmp`) })
    expect((await post({ ...reply, homeThread: true })).status).toBe(200)
    expect((await post({ ...reply, homeThread: true })).status).toBe(503)
    expect(resumeSession).toHaveBeenCalledOnce()
  })

  it('gives the bot the same answer nonce if the server post fails', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    const callbackUrl = 'http://localhost:8348/callback'
    discord.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const notify = new Promise<{ replied: boolean; nonce: string }>(resolve => {
      discord.mockImplementationOnce(async (_url, init) => {
        resolve(JSON.parse(String(init?.body)))
        return Response.json({ ok: true })
      })
    })
    expect((await post({ ...reply, homeThread: true, callbackUrl })).status).toBe(200)
    runEvents.current = [{ message: { type: 'assistant', message: { content: 'Five passed.' } } }]
    sessionEvents.emit('session_ended', 'S1', 'completed')
    const callback = await notify
    const attempted = JSON.parse(String(discord.mock.calls[0][1]?.body))
    expect(callback).toMatchObject({ replied: false, nonce: attempted.nonce })
    expect(attempted).toMatchObject({ enforce_nonce: true, nonce: expect.any(String) })
  })

  it('honors a link in a thread that is itself configured as a channel trigger', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getChannelTrigger.mockReturnValue({ ...fan, channelId: 'M0' })
    const res = await post({
      channelId: 'M0', message: 'A composed mention prompt', messageId: 'subject-message',
      originReply: { threadId: 'M0', messageId: 'R1', text: 'How many passed?' },
    })
    expect(await res.json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession.mock.calls[0][1]).toBe(followUpPrompt('chip', reply.followUp))
  })
})

describe('discord webhook: a thread is one session', () => {
  let file: string
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CCC_WEBHOOK_SECRET = 'test-secret'
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')), 'discord-threads.json')
    process.env.C3_DISCORD_THREADS_FILE = file
    getChannelTrigger.mockReturnValue(fan)
    startSession.mockResolvedValue('S1')
    isSessionActive.mockReturnValue(false)
    getSession.mockReturnValue({ id: 'S1' })
    getSessionJSONLPath.mockReturnValue('/x/S1.jsonl')
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: '' })
    runEvents.current = []
    sessionEvents.removeAllListeners()
  })
  afterEach(() => {
    delete process.env.C3_DISCORD_THREADS_FILE
  })

  it('starts a session for the first message and links the thread to it', async () => {
    const res = await post({ message: 'how were calls?', threadId: 'T1' })
    expect((await res.json()).status).toBe('started')
    expect(startSession).toHaveBeenCalledOnce()
    expect(sessionForThread('T1', file)?.sessionId).toBe('S1')
  })

  it('resumes the same session for a reply in the thread, with only the new message', async () => {
    await post({ message: 'how were calls?', threadId: 'T1' })
    startSession.mockClear()
    const res = await post({ message: 'Conversation so far ... New message from chip in this thread: and last month?', threadId: 'T1', followUp: 'and last month?', messageId: 'M2' })
    const json = await res.json()
    expect(json).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).toHaveBeenCalledOnce()
    const [sid, prompt, opts] = resumeSession.mock.calls[0]
    expect(sid).toBe('S1')
    expect(prompt).toContain('<message>\nand last month?\n</message>')
    expect(prompt).not.toContain('Conversation so far')
    expect(opts).toEqual({ label: 'discord:superfan-tour-calls', maxDurationMs: 1000, model: 'm' })
  })

  it('answers busy while the thread session is still running', async () => {
    await post({ message: 'q', threadId: 'T1' })
    isSessionActive.mockReturnValue(true)
    const res = await post({ message: 'x', threadId: 'T1', followUp: 'more' })
    expect(res.status).toBe(409)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('starts a new session from the thread text when the linked session is gone, and relinks', async () => {
    await post({ message: 'q', threadId: 'T1' })
    getSession.mockReturnValue(undefined)
    startSession.mockResolvedValue('S2')
    const res = await post({ message: 'composed thread', threadId: 'T1', followUp: 'more' })
    expect((await res.json()).status).toBe('started')
    expect(resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('T1', file)?.sessionId).toBe('S2')
  })

  it('treats a session whose transcript is gone as gone', async () => {
    await post({ message: 'q', threadId: 'T1' })
    getSessionJSONLPath.mockReturnValue(null)
    startSession.mockResolvedValue('S3')
    const res = await post({ message: 'composed', threadId: 'T1', followUp: 'more' })
    expect((await res.json()).status).toBe('started')
    expect(resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('T1', file)?.sessionId).toBe('S3')
  })

  it('never resumes on an empty reply', async () => {
    await post({ message: 'q', threadId: 'T1' })
    await post({ message: 'composed', threadId: 'T1', followUp: '   ' })
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('runs the precheck before resuming, and a skip resumes nothing', async () => {
    await post({ message: 'q', threadId: 'T1' })
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'budget' })
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'over budget' })
    const res = await post({ message: 'composed', threadId: 'T1', followUp: 'more' })
    expect((await res.json()).status).toBe('skipped')
    expect(runPrecheck).toHaveBeenCalledWith('budget', '/p', expect.objectContaining({ C3_MESSAGE: 'composed' }))
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('tells a second message in the same thread it is busy while the first is still starting', async () => {
    let release!: () => void
    let signal!: () => void
    const inPrecheck = new Promise<void>(resolve => { signal = resolve })
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'slow' })
    runPrecheck.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ proceed: true, exitCode: 0, reason: '' })
      signal()
    }))
    const first = post({ message: 'q', threadId: 'T1' })
    await inPrecheck
    const second = await post({ message: 'composed', threadId: 'T1', followUp: 'quick' })
    expect(second.status).toBe(409)
    release()
    expect((await (await first).json()).status).toBe('started')
    const third = await post({ message: 'composed', threadId: 'T1', followUp: 'later' })
    expect((await third.json()).status).toBe('resumed')
  })

  it('posts the answer of this run, not an earlier one', async () => {
    process.env.DISCORD_BOT_TOKEN = 'tok'
    const sent: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (_u: unknown, init?: { body?: string }) => { sent.push(String(init?.body)); return new Response('{}') }) as typeof fetch
    try {
      await post({ message: 'q', threadId: 'T1' })
      sessionEvents.removeAllListeners()
      await post({ message: 'composed', threadId: 'T1', followUp: 'and last month?' })
      runEvents.current = [{ message: { type: 'assistant', message: { content: [{ type: 'text', text: 'Last month: 31 calls.' }] } } }]
      await Promise.all(sessionEvents.listeners('session_ended').map(listener => listener('S1', 'completed')))
      expect(sent.join()).toContain('Last month: 31 calls.')
      expect(sent.join()).not.toContain('failed')
    } finally {
      globalThis.fetch = realFetch
      delete process.env.DISCORD_BOT_TOKEN
    }
  })

  it('starts fresh for a reply in a thread nobody linked (a thread a person opened)', async () => {
    const res = await post({ message: 'composed', threadId: 'T9', followUp: 'hi' })
    expect((await res.json()).status).toBe('started')
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('never links or resumes for a trigger without threads', async () => {
    getChannelTrigger.mockReturnValue({ ...fan, thread: undefined })
    await post({ message: 'q', threadId: 'T1' })
    await post({ message: 'q', threadId: 'T1', followUp: 'more' })
    expect(resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('T1', file)).toBeNull()
  })

  it('does not resume another trigger’s session from a shared thread id', async () => {
    await post({ message: 'q', threadId: 'T1' })
    expect(resolveResumable('T1', 'superfan-scout')).toBeNull()
    getChannelTrigger.mockReturnValue({ ...fan, name: 'superfan-scout' })
    await post({ message: 'q', threadId: 'T1', followUp: 'more' })
    expect(resumeSession).not.toHaveBeenCalled()
  })
})

describe('followUpPrompt', () => {
  it('names the author, carries the trimmed message, and says how to answer', () => {
    expect(followUpPrompt('chip', '  and last month?  ')).toBe([
      'chip replied in the Discord thread:',
      '',
      '<message>',
      'and last month?',
      '</message>',
      '',
      'Answer this message. Your final message is posted in the thread for them: the answer first,',
      'short. Do not post to Discord yourself, and do not start new work they did not ask for.',
    ].join('\n'))
  })
})

describe('discord-threads store', () => {
  it('drops links older than 30 days when writing, keeps recent ones', async () => {
    const { linkThread } = await import('@/lib/webhooks/discord-threads')
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')), 'x.json')
    linkThread('OLD', 'S0', 't', new Date('2026-09-01T00:00:00Z'), file)
    linkThread('EDGE', 'S9', 't', new Date('2026-09-13T23:59:00Z'), file)
    linkThread('MID', 'S1', 't', new Date('2026-09-14T00:01:00Z'), file)
    linkThread('NEW', 'S2', 't', new Date('2026-10-14T00:00:00Z'), file)
    expect(sessionForThread('OLD', file)).toBeNull()
    expect(sessionForThread('EDGE', file)).toBeNull()
    expect(sessionForThread('MID', file)?.sessionId).toBe('S1')
    expect(sessionForThread('NEW', file)?.sessionId).toBe('S2')
  })
})

describe('discord webhook: a thread whose run needs nothing from Chip is archived', () => {
  const ciRed = { ...fan, name: 'tour-ci-red', webhookId: 'W1' }
  let dir: string
  let realFetch: typeof fetch
  let calls: { url: string; method: string; body: string }[]
  beforeEach(() => {
    vi.clearAllMocks()
    sessionEvents.removeAllListeners()
    process.env.CCC_WEBHOOK_SECRET = 'test-secret'
    process.env.DISCORD_BOT_TOKEN = 'tok'
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-route-'))
    process.env.C3_DISCORD_THREADS_FILE = path.join(dir, 'threads.json')
    getChannelTrigger.mockReturnValue(ciRed)
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: '' })
    startSession.mockResolvedValue('S1')
    calls = []
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (u: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(u), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ id: 'REPLY1' }))
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.C3_DISCORD_THREADS_FILE
  })

  async function finish(reason: string, text: string, body: Record<string, unknown> = {}) {
    await post({ message: 'red run', threadId: 'T1', ...body })
    runEvents.current = text ? [{ message: { type: 'assistant', message: { content: [{ type: 'text', text }] } } }] : []
    await Promise.all(sessionEvents.listeners('session_ended').map(listener => listener('S1', reason)))
    return calls.filter(c => c.method === 'PATCH')
  }

  it('archives the thread after a quiet report with the inbox retired', async () => {
    const patches = await finish('completed', 'Flaky test, fix PR opened with auto-merge.')
    expect(patches).toEqual([{ url: 'https://discord.com/api/v10/channels/T1', method: 'PATCH', body: JSON.stringify({ archived: true }) }])
    expect(calls.map(c => c.method)).toEqual(['POST', 'PATCH'])
  })

  it('keeps the thread open when the report asks Chip', async () => {
    expect(await finish('completed', `${'Long report. '.repeat(150)}\nNeeds from you: merge it?`)).toEqual([])
    expect(calls.map(c => c.method)).toEqual(['POST'])
  })

  it('keeps the thread open when the run failed', async () => {
    expect(await finish('crashed: stalled', '')).toEqual([])
    expect(calls.map(c => c.method)).toEqual(['POST'])
  })

  it('keeps a thread a person started open: their answer is for them', async () => {
    getChannelTrigger.mockReturnValue(fan)
    expect(await finish('completed', 'Last month: 31 calls.')).toEqual([])
  })

  it('keeps the thread open when the archive call fails, after logging it', async () => {
    globalThis.fetch = vi.fn(async (u: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(u), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      return init?.method === 'PATCH' ? new Response('{}', { status: 403 }) : new Response(JSON.stringify({ id: 'REPLY1' }))
    }) as typeof fetch
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await finish('completed', 'Done.')).toHaveLength(1)
    expect(err).toHaveBeenCalledWith('[Webhook] Archiving thread T1 failed: 403')
    err.mockRestore()
  })

  it('archives the empty thread of a webhook post the precheck skipped', async () => {
    getChannelTrigger.mockReturnValue({ ...ciRed, precheck: 'seen' })
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'already handled' })
    const res = await post({ message: 'red run', threadId: 'T1', threadCreated: true })
    expect((await res.json()).status).toBe('skipped')
    expect(calls).toEqual([{ url: 'https://discord.com/api/v10/channels/T1', method: 'PATCH', body: JSON.stringify({ archived: true }) }])
  })

  it('leaves a reused thread alone when its replayed post is skipped: it holds the earlier report', async () => {
    getChannelTrigger.mockReturnValue({ ...ciRed, precheck: 'seen' })
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'already handled' })
    await post({ message: 'red run', threadId: 'T1', threadCreated: false })
    expect(calls).toEqual([])
  })

  it('leaves the thread open when a skipped message is a reply in it', async () => {
    getChannelTrigger.mockReturnValue({ ...ciRed, precheck: 'seen' })
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'already handled' })
    await post({ message: 'composed', threadId: 'T1', threadCreated: true, followUp: 'why did it fail?' })
    expect(calls).toEqual([])
  })

  it('leaves a skipped thread open when a person started it', async () => {
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'budget' })
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'over budget' })
    await post({ message: 'how were calls?', threadId: 'T1', threadCreated: true })
    expect(calls).toEqual([])
  })

  it('never archives a channel message that has no thread', async () => {
    getChannelTrigger.mockReturnValue({ ...ciRed, thread: undefined })
    expect(await finish('completed', 'Done.', { threadId: undefined })).toEqual([])
  })
})
