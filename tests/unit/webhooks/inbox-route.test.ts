import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveSession, getSession } = vi.hoisted(() => ({
  getActiveSession: vi.fn(), getSession: vi.fn(),
}))
vi.mock('@/lib/sdk/session-manager', () => ({ sessionManager: { getActiveSession } }))
vi.mock('@/lib/store/sessions', () => ({ getSession }))

import { POST } from '@/app/api/webhooks/inbox/route'
import { linkThread, sessionForThread } from '@/lib/webhooks/discord-threads'

function call(body: unknown, auth = 'Bearer s3cret') {
  return POST(new Request('http://localhost/api/webhooks/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

const valid = { sourceChannelId: 'C1', sourceMessageId: 'M1', text: 'Daily report', agent: 'cron:hint', sessionId: 'S1' }

describe('POST /api/webhooks/inbox', () => {
  let file: string

  beforeEach(() => {
    vi.resetAllMocks()
    file = join(mkdtempSync(join(tmpdir(), 'home-thread-links-')), 'threads.json')
    vi.stubEnv('C3_DISCORD_THREADS_FILE', file)
    vi.stubEnv('CCC_WEBHOOK_SECRET', 's3cret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('refuses a caller without the secret', async () => {
    expect((await call(valid, 'Bearer nope')).status).toBe(401)
    expect(sessionForThread('M1')).toBeNull()
  })

  it('refuses everyone when the server has no secret configured', async () => {
    vi.stubEnv('CCC_WEBHOOK_SECRET', undefined)
    expect((await call(valid, 'Bearer undefined')).status).toBe(401)
  })

  it('refuses malformed JSON, a non-object body, or a missing source message', async () => {
    expect((await call('not json')).status).toBe(400)
    expect((await call(null)).status).toBe(400)
    expect((await call({ ...valid, text: '' })).status).toBe(400)
    expect((await call({ ...valid, sourceMessageId: undefined })).status).toBe(400)
  })

  it('links a live cron run by message ID, even before a thread exists, and leaves the link untouched on retry', async () => {
    getActiveSession.mockReturnValue({ label: 'cron:daily' })
    getSession.mockReturnValue({ source: 'slack:old' })
    const first = await call(valid)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ status: 'linked' })
    expect(sessionForThread('M1')).toMatchObject({ sessionId: 'S1', trigger: 'cron:daily' })
    const saved = readFileSync(file, 'utf-8')
    const retry = await call(valid)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ status: 'already' })
    expect(readFileSync(file, 'utf-8')).toBe(saved)
  })

  it('links a finished Slack run using its stored source', async () => {
    getSession.mockReturnValue({ source: 'slack:alerts' })
    expect(await (await call(valid)).json()).toEqual({ status: 'linked' })
    expect(sessionForThread('M1')).toMatchObject({ sessionId: 'S1', trigger: 'slack:alerts' })
  })

  it('acknowledges web and missing sessions without trusting the agent hint', async () => {
    getSession.mockReturnValue({ source: 'web' })
    for (const report of [valid, { ...valid, sessionId: undefined }]) {
      const response = await call(report)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'not-a-trigger-run' })
    }
    expect(sessionForThread('M1')).toBeNull()
  })

  it('refuses to overwrite the link with a different session', async () => {
    getActiveSession.mockReturnValue({ label: 'cron:daily' })
    linkThread('M1', 'original', 'cron:daily')
    const response = await call(valid)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ status: 'conflict' })
    expect(sessionForThread('M1')?.sessionId).toBe('original')
  })

  it('reports a storage failure so the poster can keep the report in its outbox', async () => {
    getActiveSession.mockReturnValue({ label: 'cron:daily' })
    mkdirSync(`${file}.tmp`)
    expect((await call(valid)).status).toBe(502)
  })
})
