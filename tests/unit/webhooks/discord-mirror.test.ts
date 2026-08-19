import { describe, it, expect } from 'vitest'
import {
  DISCORD_CONTENT_LIMIT,
  chunkDiscordContent,
  formatAlertMirror,
  formatInvestigationReply,
  postDiscordChunked,
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
})
