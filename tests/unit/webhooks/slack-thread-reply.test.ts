import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, transcriptPath, loadPromptTemplate, manager, trigger } = vi.hoisted(() => ({
  getSession: vi.fn(),
  transcriptPath: vi.fn(),
  loadPromptTemplate: vi.fn(),
  manager: {
    on: vi.fn(), removeListener: vi.fn(), isSessionActive: vi.fn(), getRunEvents: vi.fn(),
    startSession: vi.fn(), resumeSession: vi.fn(),
  },
  trigger: {
    name: 'reports', channelId: 'CREPORT', threadsOnly: true, slackBotToken: 'report-bot',
    prompt: 'mentorly-reports.md', projectPath: '/workspace/mentorly-meta', model: 'm', permissionMode: 'default',
  },
}))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: manager }))
vi.mock('@/lib/store/sessions', () => ({ getSession }))
vi.mock('@/lib/claude-sessions/scanner', () => ({ getSessionJSONLPath: transcriptPath }))
vi.mock('@/lib/triggers/config', () => ({
  getSlackTrigger: (channelId: string) => channelId === trigger.channelId ? trigger : null,
  loadPromptTemplate,
}))
vi.mock('@/lib/usage', () => ({ recordSkippedRun: vi.fn() }))

import { linkThread, recordSlackThreadReply, sessionForThread } from '@/lib/webhooks/discord-threads'
import { POST } from '@/app/api/webhooks/slack/route'

const threadTs = '1.000001'
const messageTs = '2.000001'
const threadKey = `slack:CREPORT:${threadTs}`
const message = {
  channelId: 'CREPORT', threadTs, messageTs, author: 'Chip', followUp: 'What changed?', message: 'Full thread',
}

function post(fields: Record<string, unknown> = {}) {
  return POST(new Request('http://c3.test/api/webhooks/slack', {
    method: 'POST', headers: { Authorization: 'Bearer secret' }, body: JSON.stringify({ ...message, ...fields }),
  }))
}

function assistant(text: string, stop_reason = 'end_turn') {
  return { type: 'assistant', message: { content: [{ type: 'text', text }], stop_reason } }
}

async function restartAndDrain() {
  vi.resetModules()
  const { drainSlackAnswers } = await import('@/lib/webhooks/slack-answer')
  await drainSlackAnswers()
}

describe('Slack thread reply webhook and answer delivery', () => {
  let dir: string
  let events: EventEmitter
  const slack = vi.fn<typeof fetch>()
  const postedText = () => slack.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text.replaceAll('\u200b', ''))

  beforeEach(() => {
    vi.resetAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'c3-slack-answer-'))
    vi.stubEnv('C3_DISCORD_THREADS_FILE', join(dir, 'threads.json'))
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'secret')
    vi.stubEnv('SLACK_BOT_TOKEN', undefined)
    trigger.slackBotToken = 'report-bot'
    events = new EventEmitter()
    manager.on.mockImplementation(events.on.bind(events))
    manager.removeListener.mockImplementation(events.removeListener.bind(events))
    manager.startSession.mockImplementation(async ({ sessionId }) => sessionId)
    manager.isSessionActive.mockReturnValue(false)
    manager.getRunEvents.mockReturnValue([])
    loadPromptTemplate.mockReturnValue('Workspace prompt')
    slack.mockImplementation(async () => Response.json({ ok: true, ts: '3.000001' }))
    vi.stubGlobal('fetch', slack)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    [{ channelId: '' }, 'Missing channelId or message'],
    [{ message: '' }, 'Missing channelId or message'],
    [{ threadTs: undefined, followUp: undefined }, 'Missing threadTs or followUp'],
    [{ followUp: '    ' }, 'Missing threadTs or followUp'],
    [{ messageTs: undefined }, 'Invalid messageTs'],
    [{ messageTs: 'bad-ts' }, 'Invalid messageTs'],
    [{ messageTs: 123 }, 'Invalid messageTs'],
  ])('returns 400 for an invalid thread request %j', async (fields, error) => {
    const response = await post(fields)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(manager.startSession).not.toHaveBeenCalled()
    expect(manager.resumeSession).not.toHaveBeenCalled()
  })

  it('starts a fresh session for an unlinked thread using the configured prompt', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    const { sessionId } = manager.startSession.mock.calls[0][0]
    expect(await response.json()).toEqual({ sessionId, status: 'started', trigger: 'reports' })
    expect(sessionForThread(threadKey)?.sessionId).toBe(sessionId)
    expect(loadPromptTemplate).toHaveBeenCalledExactlyOnceWith(trigger.prompt, expect.objectContaining({
      sessionId, message: 'Full thread', threadTs, messageTs, author: 'Chip',
    }))
    expect(manager.startSession.mock.calls[0][0].prompt).toContain('Workspace prompt')
    expect(manager.resumeSession).not.toHaveBeenCalled()
  })

  it('returns 409 when the linked session is busy and accepts no new turn', async () => {
    linkThread(threadKey, 'busy-session', 'reports')
    manager.isSessionActive.mockReturnValue(true)
    const response = await post()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ sessionId: 'busy-session', status: 'busy', trigger: 'reports' })
    expect(manager.startSession).not.toHaveBeenCalled()
    expect(manager.resumeSession).not.toHaveBeenCalled()
  })

  it('rejects a reply when the Slack bot token is missing', async () => {
    trigger.slackBotToken = ''
    const response = await post()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'missing_slack_token' })
    expect(manager.startSession).not.toHaveBeenCalled()
  })

  it('retries the same reply after a definite SDK launch failure', async () => {
    manager.startSession.mockRejectedValueOnce(new Error('SDK launch rejected'))
    await expect(post()).rejects.toThrow('SDK launch rejected')
    expect((await post()).status).toBe(200)
    expect(manager.startSession).toHaveBeenCalledTimes(2)
  })

  it('preserves reply receipts only for the same trigger when relinking', () => {
    const receipt = { sessionId: 'old', status: 'started' as const }
    const accepted = { sessionId: 'new', status: 'resumed' as const }
    const previous = { sessionId: 'old', trigger: 'reports', linkedAt: new Date().toISOString(), slackReplies: { a: receipt } }
    recordSlackThreadReply(threadKey, 'reports', 'b', accepted, previous)
    expect(sessionForThread(threadKey)?.slackReplies).toEqual({ a: receipt, b: accepted })
    recordSlackThreadReply(threadKey, 'different', 'b', accepted, previous)
    expect(sessionForThread(threadKey)?.slackReplies).toEqual({ b: accepted })
  })

  it.each(['missing', 'stale'])('persists the answer before launch and repairs a %s link after restart', async link => {
    const threadFile = join(dir, 'threads.json')
    if (link === 'stale') linkThread(threadKey, 'stale-session', 'reports', new Date(Date.now() - 60_000))
    const original = existsSync(threadFile) ? readFileSync(threadFile, 'utf8') : '{}'
    manager.startSession.mockImplementation(async ({ sessionId, prompt }) => {
      const file = join(dir, 'slack-answers.json')
      expect(existsSync(file)).toBe(true)
      expect(Object.values(JSON.parse(readFileSync(file, 'utf8')))).toContainEqual(expect.objectContaining({
        sessionId, channelId: 'CREPORT', threadTs, replyId: messageTs,
      }))
      const transcript = join(dir, 'session.jsonl')
      writeFileSync(transcript, [
        { type: 'user', message: { content: prompt }, timestamp: new Date().toISOString() },
        assistant('Answer with [private docs](https://docs.ideaplaces.com/path)'),
      ].map(value => JSON.stringify(value)).join('\n'))
      transcriptPath.mockReturnValue(transcript)
      return sessionId
    })
    const accepted = await post()
    expect(accepted.status).toBe(200)
    const receipt = await accepted.json()
    writeFileSync(threadFile, original)
    getSession.mockReturnValue({ status: 'completed' })
    await restartAndDrain()
    await restartAndDrain()
    expect(postedText()).toEqual(['Answer with'])
    expect(await (await post()).json()).toEqual(receipt)
    expect(sessionForThread(threadKey)?.sessionId).toBe(receipt.sessionId)
    linkThread(threadKey, 'other', 'reports')
    expect(await (await post()).json()).toEqual(receipt)
    expect(sessionForThread(threadKey)?.sessionId).toBe('other')
    expect(manager.startSession).toHaveBeenCalledOnce()
  })

  it('uses the intended resumed turn and never posts the previous cron result after interruption', async () => {
    const transcript = join(dir, 'resumed.jsonl')
    writeFileSync(transcript, JSON.stringify(assistant('Earlier cron report')))
    transcriptPath.mockReturnValue(transcript)
    linkThread(threadKey, 'cron-session', 'reports')
    getSession.mockReturnValue({ status: 'idle' })
    manager.resumeSession.mockImplementation(async () => {
      expect(existsSync(join(dir, 'slack-answers.json'))).toBe(true)
    })
    expect((await post()).status).toBe(200)
    getSession.mockReturnValue({ status: 'running' })
    await restartAndDrain()
    expect(postedText()).toEqual([expect.stringContaining('Agent session failed')])
    expect(postedText()[0]).toMatch(/interrupt/i)
    expect(postedText()[0]).not.toContain('Earlier cron report')
  })

  it('does not recover a later identical follow-up as the interrupted reply', async () => {
    const transcript = join(dir, 'resumed.jsonl')
    writeFileSync(transcript, '')
    transcriptPath.mockReturnValue(transcript)
    linkThread(threadKey, 'cron-session', 'reports')
    getSession.mockReturnValue({ status: 'idle' })
    expect((await post()).status).toBe(200)
    expect((await post({ messageTs: '4.000001' })).status).toBe(200)
    const prompt = manager.resumeSession.mock.lastCall?.[1]
    writeFileSync(transcript, [
      { type: 'user', message: { content: prompt }, timestamp: new Date().toISOString() },
      assistant('Answer for second reply'),
    ].map(value => JSON.stringify(value)).join('\n'))
    getSession.mockReturnValue({ status: 'completed', lastPrompt: prompt })
    await restartAndDrain()
    expect(postedText()).toEqual([
      expect.stringContaining('Session interrupted before completing this Slack reply'),
      'Answer for second reply',
    ])
  })

  it('skips live sessions and expires pending and delivered answers after 30 days', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { sessionId } = await (await post()).json()
    manager.isSessionActive.mockReturnValue(true)
    await restartAndDrain()
    expect(slack).not.toHaveBeenCalled()

    manager.getRunEvents.mockReturnValue([{ sessionId, message: assistant('Done') }])
    manager.isSessionActive.mockReturnValue(false)
    events.emit('session_ended', sessionId, 'completed')
    await restartAndDrain()
    expect(postedText()).toEqual(['Done'])
    expect((await post({ messageTs: '4.000001' })).status).toBe(200)
    now += 30 * 86_400_000 + 1
    await restartAndDrain()
    expect(JSON.parse(readFileSync(join(dir, 'slack-answers.json'), 'utf8'))).toEqual({})
    expect(slack).toHaveBeenCalledOnce()
  })

  it('keeps the first answer through two 429s and delivers after the persisted Retry-After', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const limited = () => new Response(null, { status: 429, headers: { 'Retry-After': '90' } })
    slack.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited())
    const { sessionId } = await (await post()).json()
    manager.getRunEvents.mockReturnValue([{ sessionId, message: assistant('Original answer') }])
    events.emit('session_ended', sessionId, 'completed')
    const { drainSlackAnswers } = await import('@/lib/webhooks/slack-answer')
    await drainSlackAnswers()
    await restartAndDrain()
    expect(slack).toHaveBeenCalledTimes(1)
    now += 90_000
    await restartAndDrain()
    expect(slack).toHaveBeenCalledTimes(2)
    now += 89_999
    await restartAndDrain()
    expect(slack).toHaveBeenCalledTimes(2)
    now++
    manager.getRunEvents.mockReturnValue([{ sessionId, message: assistant('Later answer') }])
    await restartAndDrain()
    await restartAndDrain()
    expect(postedText()).toEqual(['Original answer', 'Original answer', 'Original answer'])
  })

  it('logs an outstanding reservation after restart and preserves the answer for reconciliation', async () => {
    const { sessionId } = await (await post()).json()
    const file = join(dir, 'slack-answers.json')
    const answers = JSON.parse(readFileSync(file, 'utf8'))
    const key = Object.keys(answers)[0]
    Object.assign(answers[key], { chunks: ['Captured answer'], sending: true })
    writeFileSync(file, JSON.stringify(answers))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await restartAndDrain()
    await restartAndDrain()
    expect(slack).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Slack delivery unknown'))
    expect(JSON.parse(readFileSync(file, 'utf8'))[key]).toMatchObject({
      sessionId, chunks: ['Captured answer'], sending: true,
    })
  })

  it('posts distinct answers for replies on the same thread, including a failure notice and raw Markdown fallback', async () => {
    const transcript = join(dir, 'continued.jsonl')
    writeFileSync(transcript, '')
    transcriptPath.mockReturnValue(transcript)
    const { drainSlackAnswers } = await import('@/lib/webhooks/slack-answer')
    const { sessionId } = await (await post()).json()
    manager.getRunEvents.mockReturnValue([{ sessionId, message: assistant('Partial output') }])
    events.emit('session_ended', sessionId, 'stalled')
    await drainSlackAnswers()
    getSession.mockReturnValue({ status: 'idle' })
    const second = await post({ messageTs: '4.000001' })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ sessionId, status: 'resumed' })
    const fallback = '[Broken](https://example.com/%ZZ)'
    manager.getRunEvents.mockReturnValue([{
      sessionId, message: assistant(`${fallback}\n\n[Org repository](https://github.com/Ideaplaces/c3)`),
    }])
    events.emit('session_ended', sessionId, 'completed')
    await drainSlackAnswers()
    expect(postedText()).toEqual(['*Agent session failed*\n\nSession stalled', fallback])
    const receipts = Object.values(JSON.parse(readFileSync(join(dir, 'slack-answers.json'), 'utf8')))
    expect(receipts).toMatchObject([
      { replyId: messageTs, delivered: true }, { replyId: '4.000001', delivered: true },
    ])
    for (const [, init] of slack.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ thread_ts: threadTs, channel: 'CREPORT' })
    }
  })
})
