import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { startSession, resumeSession, isSessionActive, getSession, getChannelTrigger, runPrecheck, getSessionJSONLPath, sessionEvents, runEvents } = vi.hoisted(() => ({
  sessionEvents: new (require('events').EventEmitter)(),
  runEvents: { current: [] as unknown[] },
  getSessionJSONLPath: vi.fn(),
  startSession: vi.fn(),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  isSessionActive: vi.fn().mockReturnValue(false),
  getSession: vi.fn(),
  getChannelTrigger: vi.fn(),
  runPrecheck: vi.fn(),
}))
vi.mock('@/lib/sdk/session-manager', () => ({
  sessionManager: {
    startSession,
    resumeSession,
    isSessionActive,
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
vi.mock('@/lib/triggers/config', () => ({ getChannelTrigger, loadPromptTemplate: () => 'rendered prompt' }))

import { POST } from '@/app/api/webhooks/discord/route'
import { sessionForThread, followUpPrompt } from '@/lib/webhooks/discord-threads'

const fan = { name: 'superfan-tour-calls', channelId: 'C1', prompt: 'superfan-chat.md', projectPath: '/p', permissionMode: 'bypassPermissions', model: 'm', thread: true, maxDurationMs: 1000 }

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/webhooks/discord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ channelId: 'C1', author: 'chip', messageId: 'M1', ...body }),
  }))
}

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
    getChannelTrigger.mockReturnValue({ ...fan, precheck: 'slow' })
    runPrecheck.mockReturnValueOnce(new Promise(r => { release = () => r({ proceed: true, exitCode: 0, reason: '' }) }))
    const first = post({ message: 'q', threadId: 'T1' })
    await new Promise(r => setTimeout(r, 10))
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
      sessionEvents.emit('session_ended', 'S1', 'completed')
      await new Promise(r => setTimeout(r, 10))
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
