import { describe, it, expect, beforeEach, vi } from 'vitest'

const { startSession, loadPromptTemplate, getCronTrigger } = vi.hoisted(() => ({
  startSession: vi.fn().mockResolvedValue(undefined),
  loadPromptTemplate: vi.fn().mockReturnValue('rendered prompt'),
  getCronTrigger: vi.fn(),
}))

vi.mock('@/lib/sdk/session-manager', () => ({
  sessionManager: { startSession },
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
