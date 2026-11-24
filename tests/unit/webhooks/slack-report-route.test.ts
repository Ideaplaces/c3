import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { getActiveSession } = vi.hoisted(() => ({ getActiveSession: vi.fn() }))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: { getActiveSession } }))

import { linkThread, sessionForThread } from '@/lib/webhooks/discord-threads'
import { deliveryDigest, saveSlackDelivery, slackDeliveryFile } from '@/lib/webhooks/slack-delivery'
import { formatSlackReport } from '@/lib/webhooks/slack-message'

let POST: typeof import('@/app/api/webhooks/slack-report/route').POST

it('retains the original formatting behavior when no destination is supplied', () => {
  expect(formatSlackReport('See [the session](https://c3.ideaplaces.com/sessions/abc)')).toBe('See the session')
})

it('the IdeaPlaces name never reaches the Mentorly workspace, joined to other words included', () => {
  const mentorly = { projectPath: '~/mentorly-meta' }
  for (const text of ['Fixed in ideaplaces_meta and C3_IDEAPLACES_TOKEN', 'IdeaPlacesMeta repo', 'see IdeaPlaces']) {
    expect(formatSlackReport(text, mentorly)).not.toMatch(/ideaplaces/i)
  }
})


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

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'c3-slack-report-'))
    vi.stubEnv('CCC_WEBHOOK_SECRET', 'test-secret')
    vi.stubEnv('C3_CONFIG_DIR', dir)
    vi.stubEnv('C3_DISCORD_THREADS_FILE', join(dir, 'threads.json'))
    writeFileSync(join(dir, 'triggers.json'), JSON.stringify({ slack: {
      CREPORT: { name: 'reports', channelId: 'CREPORT', slackBotToken: 'bot', reportAgents: ['daily'],
        threadsOnly: true, projectPath: '/workspace/mentorly-meta' },
      ALERTS: { name: 'alerts', channelId: 'ALERTS', slackBotToken: 'bot', reportAgents: ['daily'],
        projectPath: '/workspace/mentorly-meta' },
    } }))
    const route = await import('@/app/api/webhooks/slack-report/route')
    POST = route.POST
    vi.stubGlobal('fetch', slack)
    getActiveSession.mockReturnValue({ label: 'cron:daily' })
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
    for (const active of [undefined, { label: 'cron:other' }, { label: 'slack:other' }, { label: 'web:daily' }, { label: 'slack:reports' }]) {
      getActiveSession.mockReturnValue(active)
      expect((await post()).status).toBe(403)
    }
    expect(getActiveSession.mock.calls).toEqual(Array.from({ length: 5 }, () => [report.sessionId]))
    vi.stubEnv('CCC_WEBHOOK_SECRET', undefined)
    expect((await post({}, 'undefined')).status).toBe(401)
    expect(slack).not.toHaveBeenCalled()
  })

  it('lets a session started by a Slack trigger on the allowlist report, like a cron run', async () => {
    getActiveSession.mockReturnValue({ label: 'slack:daily' })
    expect((await post()).status).toBe(200)
  })

  it('returns the first result for concurrent and later replays of the same report', async () => {
    const responses = await Promise.all([post(), post()])
    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(result)
    }
    getActiveSession.mockReturnValue(undefined)
    vi.resetModules()
    const { POST: reloaded } = await import('@/app/api/webhooks/slack-report/route')
    const replay = await post({}, 'test-secret', reloaded)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(result)
    const conflict = await post({ head: 'different report' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'idempotency_key_conflict' })
    expect(slack).toHaveBeenCalledTimes(2)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)).toMatchObject({
      sessionId: 'cron-session', trigger: 'reports',
    })
  })

  it('uses the configured trigger name and requires a threads-only destination', async () => {
    expect((await post({ trigger: 'CREPORT' })).status).toBe(404)
    const result = await post({ trigger: 'alerts' })
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: 'Slack trigger must be threads-only' })
    expect(slack).not.toHaveBeenCalled()
  })

  it('accepts a 4000-character head and rejects a 4001-character head before posting', async () => {
    expect((await post({ head: 'a'.repeat(4001) })).status).toBe(400)
    expect(slack).not.toHaveBeenCalled()
    expect((await post({ head: 'a'.repeat(4000) })).status).toBe(200)
  })

  it('refuses a different in-flight body with the same key and allows a second key for the same session', async () => {
    let entered!: () => void
    let finish!: (response: Response) => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const held = new Promise<Response>(resolve => { finish = resolve })
    slack.mockImplementationOnce(async () => {
      entered()
      return await held
    })
    const first = post({ body: 'first body' })
    await started
    try {
      const conflict = await post({ body: 'changed body' })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toEqual({ error: 'idempotency_key_conflict' })
      expect(slack).toHaveBeenCalledOnce()
    } finally {
      finish(Response.json({ ok: true, ts: result.ts }))
      await first
    }
    expect((await post({ idempotencyKey: 'another report', body: 'changed body' })).status).toBe(200)
    expect(slack.mock.calls.filter(([url]) => String(url).includes('chat.postMessage'))).toHaveLength(4)
  })

  it('overwrites a link created by a reply that raced the report head receipt', async () => {
    slack.mockImplementationOnce(async () => {
      linkThread(`slack:CREPORT:${result.ts}`, 'race-session', 'reports')
      return Response.json({ ok: true, ts: result.ts })
    })
    expect((await post()).status).toBe(200)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)).toMatchObject({ sessionId: report.sessionId })
  })

  it('removes IdeaPlaces links, labels, and names in Mentorly heads and bodies', async () => {
    const response = await post({
      head: 'Report\n\n[Internal docs](https://docs.ideaplaces.com/path)\n\nIdeaPlaces',
      body: 'See [Mentorly](https://mentorly.com)\n\n<https://c3-chip.ideaplaces.com/session|Agent session>\n\nideaplaces',
    })
    expect(response.status).toBe(200)
    const posts = slack.mock.calls.filter(([url]) => String(url).includes('chat.postMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)).text.replaceAll('\u200b', ''))
    expect(posts).toEqual(['Report', 'See <https://mentorly.com|Mentorly>'])
  })

  it('posts raw Markdown when a link has malformed percent escapes', async () => {
    const head = '[Broken link](https://example.com/%ZZ)'
    expect((await post({ head })).status).toBe(200)
    expect(JSON.parse(String(slack.mock.calls[0][1]?.body)).text).toBe(head)
  })

  it('removes wrapped Markdown links and configured internal hosts even in the raw fallback', async () => {
    vi.stubEnv('C3_BASE_URL', 'https://team-c3.example')
    const head = '[Broken link](https://example.com/%ZZ)'
    const body = [
      head,
      '[Angle-wrapped](<https://docs.ideaplaces.com/reference>)',
      '[Titled link](https://team-c3.example/session "private")',
      '[Private repository](https://github.com/%49deaplaces/c3)',
      'https://example.com/?target=https%3A%2F%2Fdocs.ideaplaces.com%2Fprivate',
      'https://ideaplaces.slack.com/archives/C123',
      '[Other repository](https://github.com/another-org/example)',
      'https://ideaplaces.com should be removed',
      'https://notideaplaces.com is removed too, the name is in it',
      'https://example.org should stay',
    ].join('\n')
    expect((await post({ head: 'Report', body })).status).toBe(200)
    const text = JSON.parse(String(slack.mock.calls[1][1]?.body)).text
    expect(text).toContain(head)
    expect(text).toContain('https://example.org should stay')
    expect(text).not.toMatch(/ideaplaces/i)
    expect(text).toContain('[Other repository](https://github.com/another-org/example)')
    expect(text).not.toMatch(/Angle-wrapped|Titled link|Private repository|team-c3\.example|ideaplaces\.com\/private|target=|https:\/\/ideaplaces\./)
  })

  it('returns the Slack refusal as a bad gateway response and does not link the thread', async () => {
    slack.mockResolvedValueOnce(Response.json({ ok: false, error: 'not_in_channel' }))
    const response = await post()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'not_in_channel' })
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)).toBeNull()
  })

  it('retries a refused body reply without repeating the accepted parent', async () => {
    vi.stubEnv('C3_BASE_URL', 'https://team-c3.example')
    const body = `${'a'.repeat(3900)}\nsecond chunk [internal](https://team-c3.example/session)`
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: result.ts }))
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: '124.000001' }))
    slack.mockResolvedValueOnce(Response.json({ ok: false, error: 'channel_not_found' }))
    expect((await post({ body })).status).toBe(502)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)?.sessionId).toBe('cron-session')
    vi.stubEnv('C3_BASE_URL', 'https://updated-c3.example')
    getActiveSession.mockReturnValue(undefined)
    const replay = await post({ body })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(result)
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

  it('records uncertain Slack 5xx mid-body and keeps the same key reserved after restart', async () => {
    const body = `${'a'.repeat(3900)}\nsecond chunk`
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: result.ts }))
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: '124.000001' }))
    slack.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const unknown = await post({ body })
    expect(unknown.status).toBe(502)
    expect(await unknown.json()).toEqual({ error: 'slack_delivery_unknown' })
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)?.sessionId).toBe(report.sessionId)
    vi.resetModules()
    const { POST: reloaded } = await import('@/app/api/webhooks/slack-report/route')
    const replay = await post({ body }, 'test-secret', reloaded)
    expect(replay.status).toBe(502)
    expect(await replay.json()).toEqual({ error: 'slack_delivery_unknown' })
    expect(slack).toHaveBeenCalledTimes(3)
  })

  it('retries a missing permalink without sending the head or body twice', async () => {
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: result.ts }))
    slack.mockResolvedValueOnce(Response.json({ ok: true, ts: '124.000001' }))
    slack.mockResolvedValueOnce(Response.json({ ok: true }))
    const missing = await post({ body: 'details' })
    expect(missing.status).toBe(502)
    expect(await missing.json()).toEqual({ error: 'slack_missing_permalink' })
    linkThread(`slack:CREPORT:${result.ts}`, 'replacement-session', 'reports')
    const replay = await post({ body: 'details' })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(result)
    expect(sessionForThread(`slack:CREPORT:${result.ts}`)?.sessionId).toBe('replacement-session')
    expect(slack.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/chat.postMessage', '/api/chat.postMessage', '/api/chat.getPermalink', '/api/chat.getPermalink',
    ])
  })

  it('reports unknown progress for a partially delivered legacy report with no saved chunks', async () => {
    const body = 'Second chunk'
    const key = deliveryDigest(['report', 'CREPORT', report.idempotencyKey])
    const fingerprint = deliveryDigest([report.trigger, report.sessionId, report.head, body])
    writeFileSync(slackDeliveryFile(), JSON.stringify({ [key]: { fingerprint, ts: result.ts, chunksPosted: 1 } }))
    const replay = await post({ body })
    expect(replay.status).toBe(502)
    expect(await replay.json()).toEqual({ error: 'slack_delivery_unknown' })
    expect(slack).not.toHaveBeenCalled()
  })

  it('preserves an unreadable report ledger and makes no Slack calls', async () => {
    const file = slackDeliveryFile()
    writeFileSync(file, '{invalid')
    const response = await post()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Slack report state unavailable' })
    expect(slack).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe('{invalid')
  })

  it('prunes report delivery state older than 30 days on write', () => {
    const file = slackDeliveryFile()
    const now = Date.now()
    const state = { fingerprint: 'fingerprint', chunksPosted: 1 }
    writeFileSync(file, JSON.stringify({
      old: { ...state, updatedAt: now - 30 * 86_400_000 - 60_000 },
      recent: { ...state, updatedAt: now - 30 * 86_400_000 + 60_000 },
      legacy: state,
    }))
    const legacyTimestamp = statSync(file).mtimeMs
    saveSlackDelivery(file, 'new', state)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys(saved).sort()).toEqual(['legacy', 'new', 'recent'])
    expect(saved.legacy.updatedAt).toBe(legacyTimestamp)
    expect(saved.new.updatedAt).toBeGreaterThanOrEqual(now)
  })
})
