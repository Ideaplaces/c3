import { describe, it, expect, vi } from 'vitest'
import {
  DISCORD_CONTENT_LIMIT,
  chunkDiscordContent,
  formatAlertMirror,
  formatInvestigationReply,
  isRetryableDiscordStatus,
  postDiscordChunked,
  postDiscordMessage,
  slackMarkdownToDiscord,
} from '../../../src/lib/webhooks/discord-mirror'

describe('chunkDiscordContent', () => {
  it('returns a single chunk when the content fits', () => {
    expect(chunkDiscordContent('short alert')).toEqual(['short alert'])
  })

  it('returns nothing for empty content', () => {
    expect(chunkDiscordContent('')).toEqual([])
  })

  it('keeps every chunk under the Discord message limit', () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} of the investigation`).join('\n')
    const chunks = chunkDiscordContent(body)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT)
  })

  it('preserves every line across the split', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`)
    const chunks = chunkDiscordContent(lines.join('\n'), 120)
    const rejoined = chunks.join('\n').split('\n')
    for (const line of lines) expect(rejoined).toContain(line)
  })

  it('closes and reopens a code fence that straddles a split', () => {
    const code = Array.from({ length: 40 }, (_, i) => `  const x${i} = ${i}`).join('\n')
    const chunks = chunkDiscordContent(`before\n\`\`\`\n${code}\n\`\`\`\nafter`, 200)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // Every chunk must contain an even number of fences, i.e. be self-closing.
      const fences = chunk.split('\n').filter(l => l.trimStart().startsWith('```')).length
      expect(fences % 2).toBe(0)
    }
  })

  it('hard-splits a single line that exceeds the limit', () => {
    const chunks = chunkDiscordContent('x'.repeat(5000), 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100)
    expect(chunks.join('').replace(/\n/g, '')).toBe('x'.repeat(5000))
  })

  it('rejects a non-positive limit rather than looping forever', () => {
    expect(() => chunkDiscordContent('anything', 0)).toThrow(/positive/)
  })
})

describe('formatAlertMirror', () => {
  const base = {
    channelName: 'alerts-backend-production',
    author: 'alert-summarizer',
    message: '500 on DELETE /users/current, 12 events',
    sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
    sessionUrl: 'https://c3.example.com/sessions/abcdef12',
  }

  it('carries the channel, the alert body, and a live session link', () => {
    const out = formatAlertMirror(base)
    expect(out).toContain('#alerts-backend-production')
    expect(out).toContain('500 on DELETE /users/current, 12 events')
    expect(out).toContain('abcdef12')
    expect(out).toContain('https://c3.example.com/sessions/abcdef12')
  })

  it('includes the Slack permalink when one is known', () => {
    const out = formatAlertMirror({ ...base, permalink: 'https://slack.com/archives/C1/p1' })
    expect(out).toContain('https://slack.com/archives/C1/p1')
  })

  it('omits the permalink line when there is none', () => {
    expect(formatAlertMirror(base)).not.toContain('slack.com')
  })

  it('promises no investigation on a mirror-only channel', () => {
    const { sessionId, sessionUrl, ...mirrorOnly } = base
    const out = formatAlertMirror(mirrorOnly)
    expect(out).toContain('#alerts-backend-production')
    expect(out).toContain('500 on DELETE /users/current, 12 events')
    expect(out).not.toContain('Investigating')
    expect(out).not.toContain(sessionUrl)
    expect(out).not.toContain(sessionId.slice(0, 8))
  })
})

describe('formatInvestigationReply', () => {
  const base = {
    body: 'Root cause: missing null check in users.service.ts:88',
    sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
    sessionUrl: 'https://c3.example.com/sessions/abcdef12',
    resumeCommand: 'cd ~/eli.health-meta && claude --resume abcdef12',
  }

  it('renders a completed investigation with the report and the resume command', () => {
    const out = formatInvestigationReply({ ...base, failed: false })
    expect(out).toContain('Investigation complete')
    expect(out).toContain('users.service.ts:88')
    expect(out).toContain('claude --resume abcdef12')
    expect(out).not.toContain('failed')
  })

  it('renders a failure with the reason so a dead agent is never silent', () => {
    const out = formatInvestigationReply({ ...base, failed: true, body: 'exited after 0 turns' })
    expect(out).toContain('Agent session failed')
    expect(out).toContain('exited after 0 turns')
    expect(out).toContain('claude --resume abcdef12')
  })
})

describe('postDiscordChunked', () => {
  const longReport = Array.from({ length: 500 }, (_, i) => `finding line ${i}`).join('\n')

  function recordingPoster(ids: string[]) {
    const calls: Array<{ content: string; replyTo?: string }> = []
    let n = 0
    const poster = async (_t: string, _c: string, content: string, replyTo?: string) => {
      calls.push({ content, replyTo })
      return ids[n++] ?? null
    }
    return { poster, calls }
  }

  it('chains each continuation onto the message before it', async () => {
    const { poster, calls } = recordingPoster(['m1', 'm2', 'm3', 'm4', 'm5'])
    const first = await postDiscordChunked('tok', 'chan', longReport, 'alert-msg', poster)

    expect(calls.length).toBeGreaterThan(1)
    expect(first).toBe('m1')
    expect(calls[0].replyTo).toBe('alert-msg')
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].replyTo).toBe(`m${i}`)
    }
  })

  it('reports failure when the first message cannot be posted', async () => {
    const { poster, calls } = recordingPoster([])
    expect(await postDiscordChunked('tok', 'chan', longReport, undefined, poster)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('keeps the chain on the last delivered message when one chunk is dropped', async () => {
    const { poster, calls } = recordingPoster(['m1', null as unknown as string, 'm3', 'm4', 'm5'])
    await postDiscordChunked('tok', 'chan', longReport, 'alert-msg', poster)
    expect(calls[1].replyTo).toBe('m1')
    expect(calls[2].replyTo).toBe('m1')
  })

  it('logs a dropped continuation chunk, which the return value cannot express', async () => {
    const { poster } = recordingPoster(['m1', null as unknown as string, 'm3', 'm4', 'm5'])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // The first chunk landed, so the caller sees a success and logs one.
      expect(await postDiscordChunked('tok', 'chan', longReport, 'alert-msg', poster)).toBe('m1')
      const message = logged.mock.calls.map(args => args.join(' ')).join('\n')
      expect(message).toContain('dropped part 2/')
      expect(message).toContain('truncated')
    } finally {
      logged.mockRestore()
    }
  })
})

describe('isRetryableDiscordStatus', () => {
  it('retries what Discord can recover from on its own', () => {
    expect(isRetryableDiscordStatus(503)).toBe(true)
    expect(isRetryableDiscordStatus(500)).toBe(true)
    expect(isRetryableDiscordStatus(502)).toBe(true)
    expect(isRetryableDiscordStatus(429)).toBe(true)
  })

  it('does not retry a request Discord will refuse every time', () => {
    expect(isRetryableDiscordStatus(401)).toBe(false)
    expect(isRetryableDiscordStatus(403)).toBe(false)
    expect(isRetryableDiscordStatus(404)).toBe(false)
    expect(isRetryableDiscordStatus(400)).toBe(false)
  })
})

describe('postDiscordMessage retries', () => {
  // The production 503: Discord's edge could not reach its own backend.
  const upstream503 = {
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () =>
      'upstream connect error or disconnect/reset before headers.' +
      ' retried and the latest reset reason: remote connection failure',
  }
  const created = (id: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ id }),
  })

  function deps(responses: Array<unknown | Error>) {
    const slept: number[] = []
    let n = 0
    const fetchMock = vi.fn(async () => {
      const next = responses[n++]
      if (next instanceof Error) throw next
      return next as Response
    })
    return {
      slept,
      fetchMock,
      deps: {
        fetch: fetchMock as unknown as typeof fetch,
        sleep: async (ms: number) => {
          slept.push(ms)
        },
      },
    }
  }

  it('delivers the message when a transient 503 is followed by a success', async () => {
    const { deps: d, fetchMock, slept } = deps([upstream503, created('m9')])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report part 2', 'm1', d)).toBe('m9')
    } finally {
      logged.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(slept).toEqual([500])
  })

  it('gives up after the attempt budget so the caller can fall back', async () => {
    const { deps: d, fetchMock } = deps([upstream503, upstream503, upstream503])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report', undefined, d)).toBeNull()
    } finally {
      logged.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a refusal that will not change', async () => {
    const forbidden = {
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: async () => 'Missing Access',
    }
    const { deps: d, fetchMock } = deps([forbidden, created('never')])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report', undefined, d)).toBeNull()
    } finally {
      logged.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits the Retry-After Discord names on a 429', async () => {
    const limited = {
      ok: false,
      status: 429,
      headers: { get: (n: string) => (n === 'retry-after' ? '2' : null) },
      text: async () => 'rate limited',
    }
    const { deps: d, slept } = deps([limited, created('m4')])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report', undefined, d)).toBe('m4')
    } finally {
      logged.mockRestore()
    }
    expect(slept).toEqual([2000])
  })

  it('ignores an absurd Retry-After rather than stalling the report', async () => {
    const limited = {
      ok: false,
      status: 429,
      headers: { get: (n: string) => (n === 'retry-after' ? '3600' : null) },
      text: async () => 'rate limited',
    }
    const { deps: d, slept } = deps([limited, created('m4')])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report', undefined, d)).toBe('m4')
    } finally {
      logged.mockRestore()
    }
    expect(slept).toEqual([500])
  })

  it('retries a connection that never completed', async () => {
    const { deps: d, fetchMock, slept } = deps([new Error('ECONNRESET'), created('m7')])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await postDiscordMessage('tok', 'chan', 'report', undefined, d)).toBe('m7')
    } finally {
      logged.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(slept).toEqual([500])
  })
})

describe('slackMarkdownToDiscord', () => {
  it('converts Slack bold to Discord bold', () => {
    expect(slackMarkdownToDiscord('*What is failing:*')).toBe('**What is failing:**')
  })

  it('leaves an asterisk that is not emphasis alone', () => {
    expect(slackMarkdownToDiscord('rate is 3 * 4 per run')).toBe('rate is 3 * 4 per run')
    expect(slackMarkdownToDiscord('service api-service-* is down')).toBe(
      'service api-service-* is down',
    )
  })

  it('does not double up text that is already Discord bold', () => {
    expect(slackMarkdownToDiscord('**already bold**')).toBe('**already bold**')
  })

  it('converts a Slack link to Discord link syntax', () => {
    expect(slackMarkdownToDiscord('see <https://sentry.io/issues/1|issue 1> now')).toBe(
      'see [issue 1](https://sentry.io/issues/1) now',
    )
  })

  it('leaves a bare angle-bracket URL alone so Discord still suppresses the embed', () => {
    expect(slackMarkdownToDiscord('<https://sentry.io/issues/1>')).toBe(
      '<https://sentry.io/issues/1>',
    )
  })

  it('converts Slack strikethrough', () => {
    expect(slackMarkdownToDiscord('~was 500~')).toBe('~~was 500~~')
  })

  it('never rewrites the inside of a code span, which quotes evidence verbatim', () => {
    const input = 'saw `"culprit": "tryCallTwo(*)"` in *the logs*'
    expect(slackMarkdownToDiscord(input)).toBe('saw `"culprit": "tryCallTwo(*)"` in **the logs**')
  })

  it('leaves a fenced block untouched', () => {
    const input = '*head*\n```\nconst x = a * b\n```\n*tail*'
    expect(slackMarkdownToDiscord(input)).toBe('**head**\n```\nconst x = a * b\n```\n**tail**')
  })

  it('drops the empty-attachment placeholder', () => {
    expect(slackMarkdownToDiscord('real content\n[no preview available]\n[no preview available]'))
      .toBe('real content')
  })

  it('collapses a title the bot repeated in text and in its header block', () => {
    expect(slackMarkdownToDiscord('AI Summary: Errors\nAI Summary: Errors\nbody')).toBe(
      'AI Summary: Errors\nbody',
    )
  })

  it('collapses a repeated title when one copy carries an emoji prefix', () => {
    expect(
      slackMarkdownToDiscord('AI Summary: Errors\n:mag: AI Summary: Errors\nbody'),
    ).toBe('AI Summary: Errors\nbody')
  })

  it('keeps two adjacent lines that differ by more than decoration', () => {
    expect(slackMarkdownToDiscord('Errors - staging\nErrors - production')).toBe(
      'Errors - staging\nErrors - production',
    )
  })

  it('keeps two identical lines that are not adjacent', () => {
    expect(slackMarkdownToDiscord('same\nother\nsame')).toBe('same\nother\nsame')
  })
})
