import { describe, it, expect, beforeEach, vi } from 'vitest'

const { startSession, runningSessionWithLabel, loadPromptTemplate, getCronTrigger, runPrecheck, recordSkippedRun } = vi.hoisted(() => ({
  startSession: vi.fn().mockResolvedValue(undefined),
  runningSessionWithLabel: vi.fn().mockReturnValue(null),
  loadPromptTemplate: vi.fn().mockReturnValue('rendered prompt'),
  getCronTrigger: vi.fn(),
  runPrecheck: vi.fn(),
  recordSkippedRun: vi.fn(),
}))
vi.mock('@/lib/triggers/precheck', () => ({ runPrecheck }))
vi.mock('@/lib/usage', () => ({ recordSkippedRun }))

vi.mock('@/lib/sdk/session-manager', () => ({
  sessionManager: { startSession, runningSessionWithLabel },
}))
vi.mock('@/lib/models', () => ({ DEFAULT_MODEL: 'test-model' }))
vi.mock('@/lib/triggers/config', () => ({
  getCronTrigger,
  loadPromptTemplate,
}))

import { POST } from '@/app/api/webhooks/cron/route'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/webhooks/cron', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-secret',
    },
    body: JSON.stringify(body),
  })
}

describe('cron webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runningSessionWithLabel.mockReturnValue(null)
    process.env.CCC_WEBHOOK_SECRET = 'test-secret'
    getCronTrigger.mockReturnValue({
      name: 'assistant-review',
      schedule: '0 8 * * *',
      prompt: 'assistant-review.md',
      projectPath: '/home/chipdev/mentorly-meta',
      permissionMode: 'bypassPermissions',
      model: 'claude-opus-4-6',
    })
  })

  it('substitutes sessionId and a matching resumeCommand into the prompt template', async () => {
    const res = await POST(makeRequest({ triggerName: 'assistant-review' }))
    expect(res.status).toBe(200)

    expect(loadPromptTemplate).toHaveBeenCalledOnce()
    const [templatePath, variables] = loadPromptTemplate.mock.calls[0]
    expect(templatePath).toBe('assistant-review.md')
    expect(variables.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(variables.resumeCommand).toBe(
      `cd /home/chipdev/mentorly-meta && claude --resume ${variables.sessionId} --dangerously-skip-permissions`
    )

    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: variables.sessionId,
        projectPath: '/home/chipdev/mentorly-meta',
        prompt: 'rendered prompt',
      })
    )
  })

  it('rejects a request with the wrong secret', async () => {
    const req = new Request('http://localhost/api/webhooks/cron', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: JSON.stringify({ triggerName: 'assistant-review' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

describe('cron webhook precheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CCC_WEBHOOK_SECRET = 'test-secret'
    getCronTrigger.mockReturnValue({
      name: 'assistant-review',
      schedule: '0 8 * * *',
      prompt: 'assistant-review.md',
      projectPath: '/home/chipdev/mentorly-meta',
      permissionMode: 'bypassPermissions',
      model: 'claude-opus-5',
      precheck: 'python3 gather.py --check',
    })
  })

  it('skips the session at zero tokens when the precheck exits non-zero, and records it', async () => {
    runPrecheck.mockResolvedValue({ proceed: false, exitCode: 3, reason: 'nothing new since 297' })
    const res = await POST(makeRequest({ triggerName: 'assistant-review' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ trigger: 'assistant-review', status: 'skipped', reason: 'nothing new since 297' })
    expect(runPrecheck).toHaveBeenCalledWith('python3 gather.py --check', '/home/chipdev/mentorly-meta')
    expect(startSession).not.toHaveBeenCalled()
    expect(recordSkippedRun).toHaveBeenCalledWith('cron:assistant-review', '/home/chipdev/mentorly-meta', 'nothing new since 297')
  })

  it('starts the session when the precheck exits 0', async () => {
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: '42 new messages' })
    const res = await POST(makeRequest({ triggerName: 'assistant-review' }))
    expect((await res.json()).status).toBe('started')
    expect(startSession).toHaveBeenCalledOnce()
    expect(recordSkippedRun).not.toHaveBeenCalled()
  })

  it('does not run a precheck for a trigger without one', async () => {
    getCronTrigger.mockReturnValue({ name: 'x', schedule: '* * * * *', prompt: 'x.md', projectPath: '/tmp', permissionMode: 'bypassPermissions', model: 'm' })
    await POST(makeRequest({ triggerName: 'x' }))
    expect(runPrecheck).not.toHaveBeenCalled()
    expect(startSession).toHaveBeenCalledOnce()
  })

  it('refuses to start while the previous run of the same trigger is still going, before any precheck', async () => {
    // 2026-09-14: two loops drove one trigger into one checkout at once.
    runningSessionWithLabel.mockReturnValue('live-session-id')
    getCronTrigger.mockReturnValue({
      name: 'tour-help',
      schedule: '0 6 * * *',
      prompt: 'tour-help.md',
      projectPath: '/home/chipdev/ideaplaces-meta/ideaplaces-tour-platform',
      precheck: 'bash precheck.sh',
    })
    const res = await POST(makeRequest({ triggerName: 'tour-help' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ trigger: 'tour-help', status: 'busy', sessionId: 'live-session-id' })
    expect(runningSessionWithLabel).toHaveBeenCalledWith('cron:tour-help')
    expect(runPrecheck).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(recordSkippedRun).toHaveBeenCalledWith('cron:tour-help', expect.any(String), expect.stringContaining('live-session-id'))
  })
})
