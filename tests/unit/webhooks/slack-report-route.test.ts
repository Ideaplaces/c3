import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { getActiveSession, getSlackTriggerByName } = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  getSlackTriggerByName: vi.fn(),
}))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: { getActiveSession } }))
vi.mock('@/lib/triggers/config', () => ({ getSlackTriggerByName }))

import { POST } from '@/app/api/webhooks/slack-report/route'
import { sessionForThread } from '@/lib/webhooks/discord-threads'

const report = {
  trigger: 'reports', sessionId: 'cron-session', head: '**Daily report**',
  idempotencyKey: 'cron-session:daily-report',
}

function post(fields: Record<string, unknown> = {}, secret = 'test-secret', handler = POST) {
  return handler(new Request('http://c3.test/api/webhooks/slack-report', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ...report, ...fields }),
  }))
}

describe('Slack report webhook', () => {
  const slack = vi.fn<typeof fetch>()
  const result = { ts: '123.000001', permalink: 'https://workspace.slack.com/archives/CREPORT/p123000001' }

  beforeEach(() => {
    vi.resetAllMocks()
    const dir = mkdtempSync(join(tmpdir(), 'c3-slack-report-'))
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'test-secret')
    vi.stubEnv('C3_CONFIG_DIR', dir)
    vi.stubEnv('C3_DISCORD_THREADS_FILE', join(dir, 'threads.json'))
    vi.stubGlobal('fetch', slack)
    getActiveSession.mockReturnValue({ label: 'cron:daily' })
    getSlackTriggerByName.mockReturnValue({ name: 'reports', channelId: 'CREPORT', slackBotToken: 'bot', reportAgents: ['daily'] })
    slack.mockImplementation(async input => Response.json(String(input).includes('chat.getPermalink')
      ? { ok: true, permalink: result.permalink }
      : { ok: true, ts: result.ts }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('rejects unauthenticated requests and sessions outside the cron allowlist', async () => {
    expect((await post({}, 'wrong')).status).toBe(401)
    for (const active of [undefined, { label: 'cron:other' }, { label: 'slack:daily' }]) {
      getActiveSession.mockReturnValue(active)
      expect((await post()).status).toBe(403)
    }
    expect(slack).not.toHaveBeenCalled()
  })

  it('returns the first result for concurrent and later replays of the same report', async () => {
    const responses = await Promise.all([post(), post()])
    for (const response of responses) expect(await response.json()).toEqual(result)
    getActiveSession.mockReturnValue(undefined)
    vi.resetModules()
    const { POST: reloaded } = await import('@/app/api/webhooks/slack-report/route')
    expect(await (await post({}, 'test-secret', reloaded)).json()).toEqual(result)
    expect((await post({ head: 'different report' })).status).toBe(409)
    expect(slack).toHaveBeenCalledTimes(2)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)).toMatchObject({
      sessionId: 'cron-session', trigger: 'reports',
    })
  })

  it('returns the Slack refusal as a bad gateway response and does not link the thread', async () => {
    slack.mockResolvedValueOnce(Response.json({ ok: false, error: 'not_in_channel' }))
    const response = await post()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'not_in_channel' })
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)).toBeNull()
  })

  it('retries a refused body reply without repeating the accepted parent', async () => {
    const body = `${'a'.repeat(3900)}\nsecond chunk`
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: result.ts }))
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: '124.000001' }))
    slack.mockResolvedValueOnce(Response.json({ ok: false, error: 'channel_not_found' }))
    expect((await post({ body })).status).toBe(502)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)?.sessionId).toBe('cron-session')
    expect(await (await post({ body })).json()).toEqual(result)
    const posts = slack.mock.calls.filter(([url]) => String(url).includes('chat.postMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(posts.map(message => message.thread_ts)).toEqual([
      undefined, result.ts, result.ts, result.ts,
    ])
    expect(posts.slice(1).map(message => message.text)).toEqual(['a'.repeat(3900), 'second chunk', 'second chunk'])
  })

  it('reports unknown delivery after a lost Slack response and avoids a duplicate post', async () => {
    slack.mockRejectedValueOnce(new Error('lost connection'))
    for (const response of [await post(), await post()]) {
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'slack_delivery_unknown' })
    }
    expect(slack).toHaveBeenCalledOnce()
  })
})
