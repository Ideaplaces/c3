import { describe, it, expect } from 'vitest'
import {
  filterCandidates,
  hasProcessedReaction,
  checkCooldown,
  shouldProcessMessage,
  extractFullText,
  COOLDOWN_MS,
  PROCESSED_REACTION,
  type SlackMessage,
} from '@/lib/slack-poller/logic'

describe('filterCandidates', () => {
  const makeMsg = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
    text: 'alert message',
    ts: '1774700000.000000',
    ...overrides,
  })

  it('returns top-level messages', () => {
    const messages = [
      makeMsg({ ts: '1774700001.000000' }),
      makeMsg({ ts: '1774700002.000000' }),
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    expect(result).toHaveLength(2)
  })

  it('excludes messages with the same ts as oldest', () => {
    const messages = [
      makeMsg({ ts: '1774700000.000000' }),
      makeMsg({ ts: '1774700001.000000' }),
    ]
    const result = filterCandidates(messages, '1774700000.000000')
    expect(result).toHaveLength(1)
    expect(result[0].ts).toBe('1774700001.000000')
  })

  it('excludes thread replies (thread_ts differs from ts)', () => {
    const messages = [
      makeMsg({ ts: '1774700001.000000', thread_ts: '1774700000.000000' }), // reply
      makeMsg({ ts: '1774700002.000000' }), // top-level (no thread_ts)
      makeMsg({ ts: '1774700003.000000', thread_ts: '1774700003.000000' }), // top-level (thread_ts === ts)
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    expect(result).toHaveLength(2)
    expect(result.map(m => m.ts)).toEqual(['1774700002.000000', '1774700003.000000'])
  })

  it('includes bot_message subtype', () => {
    const messages = [
      makeMsg({ ts: '1774700001.000000', subtype: 'bot_message' }),
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    expect(result).toHaveLength(1)
  })

  it('excludes channel_join and other subtypes', () => {
    const messages = [
      makeMsg({ ts: '1774700001.000000', subtype: 'channel_join' }),
      makeMsg({ ts: '1774700002.000000', subtype: 'channel_topic' }),
      makeMsg({ ts: '1774700003.000000', subtype: 'file_share' }),
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    expect(result).toHaveLength(0)
  })

  it('sorts by timestamp ascending', () => {
    const messages = [
      makeMsg({ ts: '1774700003.000000' }),
      makeMsg({ ts: '1774700001.000000' }),
      makeMsg({ ts: '1774700002.000000' }),
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    expect(result.map(m => m.ts)).toEqual([
      '1774700001.000000',
      '1774700002.000000',
      '1774700003.000000',
    ])
  })

  it('returns empty array when no messages', () => {
    expect(filterCandidates([], '1774699999.000000')).toHaveLength(0)
  })

  it('handles the exact scenario that caused the loop: agent reply appears as top-level', () => {
    // The agent posts a reply that somehow appears as a top-level message
    // (thread_ts === ts, meaning Slack treats it as top-level)
    const messages = [
      makeMsg({ ts: '1774700001.000000', text: ':large_yellow_circle: prod - High Error Rate' }), // real alert
      makeMsg({ ts: '1774700050.000000', text: '*Error:* React hydration mismatches', thread_ts: '1774700050.000000' }), // agent reply (top-level)
    ]
    const result = filterCandidates(messages, '1774699999.000000')
    // Both pass the filter - that's expected. The reaction check is what prevents the loop.
    expect(result).toHaveLength(2)
  })
})

describe('hasProcessedReaction', () => {
  it('returns false when message has no reactions', () => {
    const msg: SlackMessage = { text: 'test', ts: '1.0' }
    expect(hasProcessedReaction(msg)).toBe(false)
  })

  it('returns false when reactions array is empty', () => {
    const msg: SlackMessage = { text: 'test', ts: '1.0', reactions: [] }
    expect(hasProcessedReaction(msg)).toBe(false)
  })

  it('returns false when different reactions exist but not eyes', () => {
    const msg: SlackMessage = {
      text: 'test', ts: '1.0',
      reactions: [
        { name: 'thumbsup', users: ['U123'] },
        { name: 'fire', users: ['U456'] },
      ],
    }
    expect(hasProcessedReaction(msg)).toBe(false)
  })

  it('returns true when eyes reaction exists', () => {
    const msg: SlackMessage = {
      text: 'test', ts: '1.0',
      reactions: [{ name: PROCESSED_REACTION, users: ['U123'] }],
    }
    expect(hasProcessedReaction(msg)).toBe(true)
  })

  it('returns true when eyes reaction exists among others', () => {
    const msg: SlackMessage = {
      text: 'test', ts: '1.0',
      reactions: [
        { name: 'thumbsup', users: ['U123'] },
        { name: PROCESSED_REACTION, users: ['U456'] },
        { name: 'fire', users: ['U789'] },
      ],
    }
    expect(hasProcessedReaction(msg)).toBe(true)
  })
})

describe('checkCooldown', () => {
  it('returns 0 when no previous session', () => {
    const times = new Map<string, number>()
    expect(checkCooldown('C123', times)).toBe(0)
  })

  it('returns 0 when cooldown has expired', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    times.set('C123', now - COOLDOWN_MS - 1000) // 1 second past cooldown
    expect(checkCooldown('C123', times, now)).toBe(0)
  })

  it('returns remaining time when in cooldown', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    times.set('C123', now - 60_000) // 1 minute ago
    const remaining = checkCooldown('C123', times, now)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(COOLDOWN_MS)
    // Should be roughly 4 minutes remaining
    expect(remaining).toBeCloseTo(COOLDOWN_MS - 60_000, -3)
  })

  it('returns remaining time when just started', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    times.set('C123', now) // just now
    const remaining = checkCooldown('C123', times, now)
    expect(remaining).toBe(COOLDOWN_MS)
  })

  it('tracks channels independently', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    times.set('C123', now) // just started
    times.set('C456', now - COOLDOWN_MS - 1000) // expired

    expect(checkCooldown('C123', times, now)).toBe(COOLDOWN_MS)
    expect(checkCooldown('C456', times, now)).toBe(0)
    expect(checkCooldown('C789', times, now)).toBe(0) // never seen
  })
})

describe('shouldProcessMessage', () => {
  const makeMsg = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
    text: 'alert',
    ts: '1774700000.000000',
    ...overrides,
  })

  it('returns process:true for a fresh message with no cooldown', () => {
    const result = shouldProcessMessage(makeMsg(), 'C123', new Map())
    expect(result.process).toBe(true)
  })

  it('returns process:false for a message with eyes reaction', () => {
    const msg = makeMsg({
      reactions: [{ name: PROCESSED_REACTION, users: ['U123'] }],
    })
    const result = shouldProcessMessage(msg, 'C123', new Map())
    expect(result.process).toBe(false)
    expect(result.reason).toBe('already_processed')
  })

  it('returns process:false when channel is in cooldown', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    times.set('C123', now - 30_000) // 30 seconds ago

    const result = shouldProcessMessage(makeMsg(), 'C123', times, now)
    expect(result.process).toBe(false)
    expect(result.reason).toMatch(/^rate_limited_/)
  })

  it('reaction check takes priority over cooldown', () => {
    // Message has eyes AND channel is in cooldown
    const msg = makeMsg({
      reactions: [{ name: PROCESSED_REACTION, users: ['U123'] }],
    })
    const times = new Map<string, number>()
    times.set('C123', Date.now())

    const result = shouldProcessMessage(msg, 'C123', times)
    expect(result.process).toBe(false)
    expect(result.reason).toBe('already_processed') // reaction checked first
  })

  it('simulates the full loop scenario: 10 rapid messages', () => {
    const times = new Map<string, number>()
    const now = Date.now()
    const results: boolean[] = []

    // Simulate 10 messages arriving rapidly
    for (let i = 0; i < 10; i++) {
      const msg = makeMsg({ ts: `1774700${String(i).padStart(3, '0')}.000000` })
      const result = shouldProcessMessage(msg, 'C123', times, now + i * 1000)

      if (result.process) {
        // Simulate: after processing, set the cooldown
        times.set('C123', now + i * 1000)
      }

      results.push(result.process)
    }

    // Only the first message should be processed, rest are rate limited
    expect(results[0]).toBe(true)
    expect(results.slice(1).every(r => r === false)).toBe(true)
  })

  it('allows processing after cooldown expires', () => {
    const times = new Map<string, number>()
    const now = Date.now()

    // First message: processed
    const result1 = shouldProcessMessage(makeMsg(), 'C123', times, now)
    expect(result1.process).toBe(true)
    times.set('C123', now)

    // Second message 1 minute later: rate limited
    const result2 = shouldProcessMessage(
      makeMsg({ ts: '1774700001.000000' }),
      'C123', times, now + 60_000
    )
    expect(result2.process).toBe(false)

    // Third message 6 minutes later: allowed
    const result3 = shouldProcessMessage(
      makeMsg({ ts: '1774700002.000000' }),
      'C123', times, now + 6 * 60_000
    )
    expect(result3.process).toBe(true)
  })
})

describe('extractFullText', () => {
  it('returns text field for simple messages', () => {
    const msg: SlackMessage = { text: 'simple message', ts: '1.0' }
    expect(extractFullText(msg)).toBe('simple message')
  })

  it('returns empty string when no content', () => {
    const msg: SlackMessage = { text: '', ts: '1.0' }
    expect(extractFullText(msg)).toBe('')
  })

  it('extracts content from section blocks when text is truncated', () => {
    const msg: SlackMessage = {
      text: 'Truncated summary...',
      ts: '1.0',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: ':warning: prod - High Error Rate' } },
        { type: 'section', text: { type: 'mrkdwn', text: 'This is the full detailed error report with all the context that was truncated in the text field' } },
      ],
    }
    const result = extractFullText(msg)
    expect(result).toContain(':warning: prod - High Error Rate')
    expect(result).toContain('full detailed error report')
    expect(result).not.toContain('...')
  })

  it('extracts context block elements', () => {
    const msg: SlackMessage = {
      text: 'Short',
      ts: '1.0',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Alert' } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '*Severity:* Warning | *Environment:* prod' }] },
        { type: 'section', text: { type: 'mrkdwn', text: 'Full error details here with a long description' } },
      ],
    }
    const result = extractFullText(msg)
    expect(result).toContain('Severity:')
    expect(result).toContain('Full error details')
  })

  it('prefers blocks over truncated text', () => {
    const msg: SlackMessage = {
      text: 'Short truncated...',
      ts: '1.0',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'This is a much longer and more detailed message from the blocks' } },
      ],
    }
    const result = extractFullText(msg)
    expect(result).toBe('This is a much longer and more detailed message from the blocks')
  })

  it('falls back to text when blocks are empty', () => {
    const msg: SlackMessage = {
      text: 'Original text',
      ts: '1.0',
      blocks: [],
    }
    expect(extractFullText(msg)).toBe('Original text')
  })

  it('falls back to text when blocks have no text content', () => {
    const msg: SlackMessage = {
      text: 'Original text',
      ts: '1.0',
      blocks: [
        { type: 'divider' },
        { type: 'actions' },
      ],
    }
    expect(extractFullText(msg)).toBe('Original text')
  })

  it('extracts attachment text', () => {
    const msg: SlackMessage = {
      text: 'Short',
      ts: '1.0',
      attachments: [
        { text: 'Detailed attachment content with error info' },
      ],
    }
    const result = extractFullText(msg)
    expect(result).toContain('Detailed attachment content')
  })

  it('extracts attachment fields', () => {
    const msg: SlackMessage = {
      text: 'Alert',
      ts: '1.0',
      attachments: [
        { fields: [
          { title: 'Error', value: 'NoMethodError' },
          { title: 'File', value: 'app/controllers/foo.rb:42' },
        ]},
      ],
    }
    const result = extractFullText(msg)
    expect(result).toContain('Error: NoMethodError')
    expect(result).toContain('File: app/controllers/foo.rb:42')
  })

  it('handles real-world alert message structure', () => {
    // Simulates the actual Slack Block Kit message from the monitoring bot
    const msg: SlackMessage = {
      text: ':large_yellow_circle: prod - High Error Rate: Minified React errors (#418 and #425) are bein...',
      ts: '1.0',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: ':large_yellow_circle: prod - High Error Rate' } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '*Severity:* Warning | *Environment:* prod | *Fired:* 2026-03-31T22:02:32Z' }] },
        { type: 'divider' },
        { type: 'section', text: { type: 'mrkdwn', text: '*AI Summary*\nHere\'s the error log analysis:\n\n**What\'s failing:**\nMinified React errors (#418 and #425) are being thrown in the frontend-client.\n\n**Where:**\nThis affects the frontend (Next.js) client, specifically on the /en/help/program-manager-guides/monetization-beta page.\n\n**Pattern:**\nThis is the same error repeated.\n\n**Suggested action:**\nCheck the React code for the Monetization Beta guide page.' } },
        { type: 'divider' },
        { type: 'actions' },
      ],
    }
    const result = extractFullText(msg)
    expect(result).toContain('High Error Rate')
    expect(result).toContain('Severity:')
    expect(result).toContain('What\'s failing')
    expect(result).toContain('monetization-beta')
    expect(result).toContain('Suggested action')
    // Should NOT be truncated
    expect(result).not.toContain('bein...')
  })
})
