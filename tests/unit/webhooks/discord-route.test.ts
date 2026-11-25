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
import { sessionForThread, followUpPrompt, linkThread, recordHomeThreadReply } from '@/lib/webhooks/discord-threads'
import { fireCronTrigger } from '@/lib/triggers/fire'
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

  it.each(['cron:daily', 'slack:alerts'])('resumes %s at 30 days and posts the original link one millisecond later', async (label) => {
    const now = Date.now()
    vi.setSystemTime(now)
    try {
      linkThread('M0', 'S1', label, new Date(now - 30 * 86_400_000))
      const atCutoff = await post({ ...reply, homeThread: true })
      expect(await atCutoff.json()).toMatchObject({ status: 'resumed', trigger: label })

      vi.setSystemTime(now + 1)
      linkThread('OTHER', 'S2', fan.name)
      const afterCutoff = await post({ ...reply, messageId: 'R2', homeThread: true })
      expect(await afterCutoff.json()).toEqual({ status: 'unavailable' })
      expect(discord).toHaveBeenCalledExactlyOnceWith('https://discord.com/api/v10/channels/M0/messages', expect.objectContaining({
        body: expect.stringContaining('https://c3.test/sessions/S1'),
      }))
      expect(resumeSession).toHaveBeenCalledOnce()
      expect(startSession).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns 502 when the unavailable note fails and reuses its nonce on retry', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getSessionJSONLPath.mockReturnValue(null)
    discord.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const request = { ...reply, homeThread: true }

    const failed = await post(request)
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'Could not post the session link in Discord' })
    const retried = await post(request)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual({ status: 'unavailable' })

    const [first, second] = discord.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(first).toMatchObject({ nonce: expect.any(String), enforce_nonce: true })
    expect(second).toEqual(first)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('starts and resumes the channel trigger conversation under a linked cron report', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'budget' })
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: '' })
    const request = { ...reply, channelId: 'C1' }
    expect(await (await post(request)).json()).toEqual({ status: 'started', sessionId: 'new-session', trigger: fan.name })
    expect(startSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ label: `discord:${fan.name}`, prompt: 'rendered prompt' }))
    expect(await (await post({ ...request, messageId: 'R2' })).json()).toEqual({ status: 'resumed', sessionId: 'new-session', trigger: fan.name })
    expect(runPrecheck).toHaveBeenCalledTimes(2)
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('new-session', followUpPrompt('chip', reply.followUp), {
      label: `discord:${fan.name}`, model: 'm', maxDurationMs: 1000,
    })
    expect(sessionForThread('M0')).toMatchObject({ sessionId: 'S1', trigger: 'cron:daily' })
  })

  it('does not let a home-only handoff bypass a thread trigger on the parent channel', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getChannelTrigger.mockImplementation(id => id === 'C1' ? { ...fan, webhookId: 'pinned' } : null)
    const response = await post({ ...reply, channelId: 'M0', homeThread: true,
      originReply: { threadId: 'M0', parentChannelId: 'C1', messageId: 'R1', text: reply.followUp },
    })
    expect(await response.json()).toEqual({ status: 'ignored' })
    expect(resumeSession).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('keeps the Slack report link when a textless reply takes the channel trigger path', async () => {
    linkThread('M0', 'S1', 'slack:alerts')
    getChannelTrigger.mockReturnValue(fan)
    const response = await post({ ...reply, channelId: 'C1', followUp: '' })
    expect(await response.json()).toMatchObject({ status: 'started', trigger: fan.name })
    expect(sessionForThread('M0')).toMatchObject({ sessionId: 'S1', trigger: 'slack:alerts' })
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('keeps the report thread conversation resumable until its 30-day link is pruned on write', async () => {
    const linkedAt = new Date(Date.now() - 31 * 86_400_000)
    linkThread('M0', 'S1', 'cron:daily', linkedAt)
    linkThread('M0', 'conversation', fan.name, linkedAt)
    getChannelTrigger.mockReturnValue(fan)
    const request = { ...reply, channelId: 'C1' }
    expect(await (await post(request)).json()).toMatchObject({ status: 'resumed', sessionId: 'conversation' })
    linkThread('OTHER', 'S2', fan.name)
    expect(await (await post({ ...request, messageId: 'R2' })).json()).toMatchObject({ status: 'started', sessionId: 'new-session' })
  })

  it('acknowledges textless home replies without launching or replacing the report session', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    for (const homeThread of [true, undefined]) {
      const response = await post({ ...reply, message: '', followUp: '', homeThread })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ignored' })
    }
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('M0')).toMatchObject({ sessionId: 'S1', trigger: 'cron:daily' })
  })

  it('ignores whitespace-only home replies, including the reply inside originReply', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    const text = ' \t\n '
    for (const request of [
      { ...reply, homeThread: true, followUp: text },
      { ...reply, originReply: { threadId: 'M0', messageId: 'R1', text } },
    ]) {
      const response = await post(request)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ignored' })
    }
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession).not.toHaveBeenCalled()
    expect(discord).not.toHaveBeenCalled()
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

  it('returns busy while the cron trigger is starting in its precheck', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getCronTrigger.mockReturnValue({ name: 'daily', precheck: 'ready', projectPath: '/cron-config' })
    let finishPrecheck!: () => void
    runPrecheck.mockReturnValueOnce(new Promise(resolve => {
      finishPrecheck = () => resolve({ proceed: true, exitCode: 0, reason: '' })
    }))
    const starting = fireCronTrigger('daily', { kind: 'clock', chain: [] })
    try {
      expect(runPrecheck).toHaveBeenCalledExactlyOnceWith('ready', '/cron-config')
      const response = await post({ ...reply, homeThread: true })
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ status: 'busy', sessionId: 'S1', trigger: 'cron:daily' })
      expect(resumeSession).not.toHaveBeenCalled()
      expect(startSession).not.toHaveBeenCalled()
      expect(sessionForThread('M0')?.discordReplies).toBeUndefined()
    } finally {
      finishPrecheck()
      await starting
    }
  })

  it('refuses to resume if the reply receipt cannot be stored', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    fs.mkdirSync(`${process.env.C3_DISCORD_THREADS_FILE}.tmp`)
    expect((await post({ ...reply, homeThread: true })).status).toBe(502)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it.each([undefined, '', ' \t\n '])('refuses to resume a linked reply with Discord message ID %j', async (messageId) => {
    linkThread('M0', 'S1', 'cron:daily')
    expect((await post({ ...reply, homeThread: true, messageId })).status).toBe(400)
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it('never resumes a second time if confirmation of the first resume fails', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    resumeSession.mockImplementationOnce(async () => { fs.mkdirSync(`${process.env.C3_DISCORD_THREADS_FILE}.tmp`) })
    expect((await post({ ...reply, homeThread: true })).status).toBe(200)
    expect((await post({ ...reply, homeThread: true })).status).toBe(503)
    expect(resumeSession).toHaveBeenCalledOnce()
  })

  it('clears the pending receipt after a rejected resume so Discord can retry the same reply', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    resumeSession.mockRejectedValueOnce(new Error('resume rejected'))
    const request = { ...reply, homeThread: true }
    expect((await post(request)).status).toBe(502)
    const retried = await post(request)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(resumeSession).toHaveBeenCalledTimes(2)
    expect(sessionForThread('M0')?.discordReplies).toEqual({ R1: 'resumed' })
  })

  it('returns busy for a pending receipt while its session is active', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    recordHomeThreadReply('M0', sessionForThread('M0')!, 'R1', 'pending')
    isSessionActive.mockReturnValue(true)
    const response = await post({ ...reply, homeThread: true })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ status: 'busy', sessionId: 'S1', trigger: 'cron:daily' })
    expect(resumeSession).not.toHaveBeenCalled()
    expect(sessionForThread('M0')?.discordReplies).toEqual({ R1: 'pending' })
  })

  it('keeps the first receipt when accepting a second reply in the same report thread', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    const first = { ...reply, homeThread: true }
    expect(await (await post(first)).json()).toMatchObject({ status: 'resumed' })
    expect(await (await post({ ...first, messageId: 'R2' })).json()).toMatchObject({ status: 'resumed' })
    expect(await (await post(first)).json()).toEqual({ status: 'already' })
    expect(resumeSession).toHaveBeenCalledTimes(2)
  })

  it('locks by report thread while a reply is starting', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    linkThread('OTHER', 'S2', 'cron:other')
    let release!: () => void
    let entered!: () => void
    const inResume = new Promise<void>(resolve => { entered = resolve })
    resumeSession.mockImplementationOnce(() => new Promise<void>(resolve => {
      release = resolve
      entered()
    }))
    const first = post({ ...reply, homeThread: true })
    await inResume
    try {
      const second = await post({ ...reply, homeThread: true, messageId: 'R2' })
      expect(second.status).toBe(409)
      expect(await second.json()).toMatchObject({ status: 'busy', sessionId: 'S1' })
      const other = await post({ ...reply, homeThread: true, threadId: 'OTHER', messageId: 'R3' })
      expect(await other.json()).toMatchObject({ status: 'resumed', sessionId: 'S2' })
    } finally {
      release()
      await first
    }
    expect(await (await first).json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(resumeSession.mock.calls.map(([sessionId]) => sessionId)).toEqual(['S1', 'S2'])
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

  it('honors a link in a thread that is itself configured as a channel trigger and uses the origin reply ID', async () => {
    linkThread('M0', 'S1', 'cron:daily')
    getChannelTrigger.mockImplementation(id => id === 'M0' ? { ...fan, channelId: 'M0' } : null)
    const res = await post({
      channelId: 'M0', message: 'A composed mention prompt', messageId: 'subject-message',
      originReply: { threadId: 'M0', parentChannelId: 'HOME', messageId: 'R1', text: 'How many passed?' },
    })
    expect(await res.json()).toMatchObject({ status: 'resumed', sessionId: 'S1' })
    expect(startSession).not.toHaveBeenCalled()
    expect(resumeSession.mock.calls[0][1]).toBe(followUpPrompt('chip', reply.followUp))
    expect(sessionForThread('M0')?.discordReplies).toEqual({ R1: 'resumed' })
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
  const storedLink = { sessionId: 'S1', trigger: 'cron:daily', linkedAt: new Date().toISOString() }
  const registryWith = (fields: Record<string, unknown>) => JSON.stringify({ M0: { ...storedLink, ...fields } })

  it.each([
    ['truncated JSON', '{ "truncated":'],
    ['an array at the root', '[]'],
    ['a link with missing fields', '{"M0":{}}'],
    ['a blank session ID', registryWith({ sessionId: ' ' })],
    ['an invalid timestamp', registryWith({ linkedAt: 'garbage' })],
    ['a malformed channel conversation', registryWith({ discordChannel: [] })],
    ['a malformed Discord receipt', registryWith({ discordReplies: { R1: 'unknown' } })],
    ['a malformed Slack receipt', registryWith({ slackReplies: { R1: { sessionId: 'S1', status: 'unknown' } } })],
  ])('throws on corrupt thread data with %s without overwriting it', (_reason, contents) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')), 'x.json')
    fs.writeFileSync(file, contents)
    expect.soft(() => sessionForThread('M0', file)).toThrow()
    expect.soft(() => linkThread('NEW', 'S1', 'cron:daily', new Date(), file)).toThrow()
    expect(fs.readFileSync(file, 'utf-8')).toBe(contents)
  })

  it('throws when the thread-link path cannot be read as a file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-'))
    expect(() => sessionForThread('M0', directory)).toThrow(/EISDIR/)
  })

  it('prunes report links older than 60 days and keeps fresh channel conversations and recent reports', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')), 'x.json')
    const now = new Date()
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)
    linkThread('OLD', 'S0', 'cron:daily', daysAgo(61), file)
    linkThread('SHARED', 'S1', 'cron:daily', daysAgo(61), file)
    linkThread('EXPIRED', 'S2', 'slack:alerts', daysAgo(31), file)
    linkThread('FRESH', 'S3', 'cron:daily', daysAgo(29), file)
    linkThread('SHARED', 'S4', fan.name, daysAgo(1), file)
    expect(sessionForThread('OLD', file)).toBeNull()
    expect(sessionForThread('SHARED', file)).toMatchObject({ sessionId: 'S4', trigger: fan.name })
    linkThread('NEW', 'S5', 'cron:daily', now, file)
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(saved.OLD).toBeUndefined()
    expect(saved.SHARED).toMatchObject({ sessionId: 'S4', trigger: fan.name })
    expect(saved.EXPIRED).toMatchObject({ sessionId: 'S2', trigger: 'slack:alerts' })
    expect(saved.FRESH).toMatchObject({ sessionId: 'S3', trigger: 'cron:daily' })
  })

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
  let postStatus: number
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
    postStatus = 200
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (u: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(u), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      return Response.json({ id: 'REPLY1' }, { status: init?.method === 'POST' ? postStatus : 200 })
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

  it('keeps the thread open when a completed run reports Run failed', async () => {
    expect(await finish('completed', 'The report could not be prepared.\nRun failed: source unavailable')).toEqual([])
    expect(calls.map(c => c.method)).toEqual(['POST'])
  })

  it('keeps the thread open when the report post to Discord fails', async () => {
    postStatus = 403
    expect(await finish('completed', 'Quiet report.')).toEqual([])
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
