import { describe, it, expect } from 'vitest'
import {
  DISCORD_CONTENT_LIMIT,
  chunkDiscordContent,
  formatAlertMirror,
  formatInvestigationReply,
  formatReportPostedLog,
  postDiscordChunked,
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

describe('formatReportPostedLog', () => {
  // Verbatim from the c3 log shipper, which mirrors the regex the Azure alert
  // summarizer scans plain log lines with. Anything a success path prints that
  // matches this becomes a false #alerts-production error.
  const ERROR_REGEX = /\b(error|exception|failed|fatal|unhandled|uncaught)\b/i

  const base = {
    channelId: '1539471007503622264',
    sessionId: '03d22e2d-1bc0-4e3d-9663-10c883cba90e',
  }

  it('does not read as an error when the investigated session failed', () => {
    const line = formatReportPostedLog({ ...base, failed: true })
    expect(line).not.toMatch(ERROR_REGEX)
    expect(line).toContain('outcome=failure')
  })

  it('does not read as an error when the investigated session succeeded', () => {
    const line = formatReportPostedLog({ ...base, failed: false })
    expect(line).not.toMatch(ERROR_REGEX)
    expect(line).toContain('outcome=success')
  })

  it('names the channel and the session so a delivered report is traceable', () => {
    const line = formatReportPostedLog({ ...base, failed: true })
    expect(line).toContain('1539471007503622264')
    expect(line).toContain('03d22e2d-1bc0-4e3d-9663-10c883cba90e')
  })

  it('distinguishes the two outcomes', () => {
    expect(formatReportPostedLog({ ...base, failed: true })).not.toBe(
      formatReportPostedLog({ ...base, failed: false }),
    )
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
