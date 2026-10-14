import { describe, it, expect } from 'vitest'
import {
  selectTriggersForBot,
  shouldFire,
  shouldFireMention,
  stripMention,
  composeMentionText,
  extractDiscordText,
  threadNameFor,
  formatSessionResult,
  routeMessage,
  agentAnswer,
  clip,
  threadBusy,
  BUSY_NOTE,
  composeThreadText,
} from '../../../src/lib/discord-bot/logic'

const feedbackEmbed = {
  title: '🔴 Broken',
  description: 'je peux pas mettre 8-10, ça fait automatiquement 81-0',
  fields: [
    { name: 'Screen', value: 'WorkoutDayEdit' },
    { name: 'Build', value: '1.0.0 (45)' },
  ],
  footer: { text: 'ydhw2rzgy7@privaterelay.appleid.com · ygFSbG1s' },
  image: { url: 'https://cdn.discordapp.com/attachments/1/2/screen.jpg?ex=1' },
}

describe('selectTriggersForBot', () => {
  const triggers = {
    alerts: { name: 'alerts', channelId: '1' },
    feedback: { name: 'feedback', channelId: '2', bot: 'spotter' },
  }

  it('gives unnamed triggers to the default bot and named ones to their bot only', () => {
    expect(selectTriggersForBot(triggers, 'default').map(t => t.name)).toEqual(['alerts'])
    expect(selectTriggersForBot(triggers, 'spotter').map(t => t.name)).toEqual(['feedback'])
    expect(selectTriggersForBot(triggers, 'other')).toEqual([])
  })
})

describe('shouldFire', () => {
  const pinned = { name: 'feedback', channelId: '2', webhookId: 'hook-1' }
  const open = { name: 'alerts', channelId: '1' }

  it('fires only for the pinned webhook and never for a human in that channel', () => {
    expect(shouldFire(pinned, { content: 'x', webhookId: 'hook-1', authorIsBot: true })).toBe(true)
    expect(shouldFire(pinned, { content: 'x', webhookId: 'hook-2', authorIsBot: true })).toBe(false)
    expect(shouldFire(pinned, { content: 'ça marche parfois', authorIsBot: false })).toBe(false)
  })

  it('without a pin, fires for humans and webhooks but not for other bots', () => {
    expect(shouldFire(open, { content: 'x', authorIsBot: false })).toBe(true)
    expect(shouldFire(open, { content: 'x', webhookId: 'any', authorIsBot: true })).toBe(true)
    expect(shouldFire(open, { content: 'x', authorIsBot: true })).toBe(false)
  })
})

describe('shouldFireMention', () => {
  const trigger = { name: 'feedback', channelId: '2', mention: true, webhookId: 'hook-1' }
  const report = { content: '', embeds: [feedbackEmbed], webhookId: 'hook-1', authorIsBot: true }
  const reply = { content: '<@99> fix this one', mentionsBot: true, referencedMessageId: 'r1', authorIsBot: false }

  it('fires only for a human reply that mentions the bot on a report from the pinned webhook', () => {
    expect(shouldFireMention(trigger, reply, report)).toBe(true)
    expect(shouldFireMention(trigger, { ...reply, mentionsBot: false }, report)).toBe(false)
    expect(shouldFireMention(trigger, { ...reply, referencedMessageId: null }, report)).toBe(false)
    expect(shouldFireMention(trigger, { ...reply, authorIsBot: true }, report)).toBe(false)
    expect(shouldFireMention(trigger, reply, { ...report, webhookId: 'other' })).toBe(false)
    expect(shouldFireMention(trigger, reply, null)).toBe(false)
  })

  it('never fires for a trigger that is not in mention mode', () => {
    expect(shouldFireMention({ ...trigger, mention: false }, reply, report)).toBe(false)
  })
})

describe('stripMention and composeMentionText', () => {
  it('removes the bot mention in both forms and keeps the request', () => {
    expect(stripMention('<@99> fix this one', '99')).toBe('fix this one')
    expect(stripMention('fix <@!99>  this one', '99')).toBe('fix this one')
  })

  it('puts the subject first and the request last, with a default when the person said nothing', () => {
    const subject = { content: '', embeds: [feedbackEmbed] }
    const text = composeMentionText(subject, 'lucararau9867', 'fix this one')
    expect(text.startsWith('**🔴 Broken**\nje peux pas mettre 8-10')).toBe(true)
    expect(text.endsWith('\n\nRequest from lucararau9867: fix this one')).toBe(true)
    expect(composeMentionText(subject, 'luca', '').endsWith('Request from luca: Take care of this one.')).toBe(true)
  })
})

describe('extractDiscordText', () => {
  it('carries the embed title, description, fields, footer and image into the text', () => {
    const text = extractDiscordText({ content: '', embeds: [feedbackEmbed] })
    expect(text).toBe(
      [
        '**🔴 Broken**',
        'je peux pas mettre 8-10, ça fait automatiquement 81-0',
        'Screen: WorkoutDayEdit',
        'Build: 1.0.0 (45)',
        'Footer: ydhw2rzgy7@privaterelay.appleid.com · ygFSbG1s',
        'Image: https://cdn.discordapp.com/attachments/1/2/screen.jpg?ex=1',
      ].join('\n'),
    )
  })

  it('keeps plain content and lists attachments with their type', () => {
    const text = extractDiscordText({
      content: 'timer est cassé',
      attachments: [{ name: 'IMG_1.png', url: 'https://cdn/x.png', contentType: 'image/png' }],
    })
    expect(text).toBe('timer est cassé\n\nAttachment: IMG_1.png https://cdn/x.png (image/png)')
  })
})

describe('threadNameFor', () => {
  it('names the thread from the embed title and its first short field', () => {
    expect(threadNameFor({ content: '', embeds: [feedbackEmbed] })).toBe('🔴 Broken · WorkoutDayEdit')
  })

  it('falls back to the first line of content and caps at 100 characters', () => {
    expect(threadNameFor({ content: 'first line\nsecond' })).toBe('first line')
    const long = threadNameFor({ content: 'a'.repeat(150) })
    expect(long.length).toBe(100)
    expect(long.endsWith('…')).toBe(true)
    expect(threadNameFor({ content: '   ' })).toBe('Report')
  })
})

describe('formatSessionResult', () => {
  it('links the session and carries the resume command', () => {
    const text = formatSessionResult(
      { sessionId: 'abcdefgh-1234', summary: 'Fixed the rep range parser.', projectPath: '/p' },
      'https://c3-chip.ideaplaces.com',
    )
    expect(text).toContain('**Session completed** (`abcdefgh`)')
    expect(text).toContain('Fixed the rep range parser.')
    expect(text).toContain('https://c3-chip.ideaplaces.com/sessions/abcdefgh-1234')
    expect(text).toContain('cd /p && claude --resume abcdefgh-1234 --dangerously-skip-permissions')
  })

  it('reports a failure with its reason instead of a summary', () => {
    const text = formatSessionResult(
      { sessionId: 'abcdefgh-1234', summary: 'ignored', failed: true, failureReason: 'context overflow' },
      'https://x',
    )
    expect(text).toContain('Agent session failed')
    expect(text).toContain('**Reason:** context overflow')
    expect(text).not.toContain('ignored')
  })
})

describe('routeMessage', () => {
  const triggers = [
    { name: 'fan', channelId: 'C1', thread: true },
    { name: 'plain', channelId: 'C2' },
    { name: 'mention', channelId: 'C3', thread: true, mention: true },
    { name: 'reports', channelId: 'C4', thread: true, webhookId: 'W' },
    { name: 'on-a-thread', channelId: 'T9', thread: true },
  ]
  const base = { channelId: 'C1', parentId: null as string | null, isThread: false, isSelf: false, isSystem: false, authorIsBot: false }
  const route = (over: Partial<typeof base>) => {
    const r = routeMessage(triggers, { ...base, ...over })
    return r.kind === 'ignore' ? 'ignore' : `${r.kind}:${r.trigger.name}`
  }
  it('sends a channel message to its trigger, as before', () => {
    expect(route({})).toBe('channel:fan')
    expect(route({ channelId: 'C2' })).toBe('channel:plain')
  })
  it('sends a person replying in a thread under a thread trigger to that trigger', () => {
    expect(route({ channelId: 'T1', parentId: 'C1', isThread: true })).toBe('thread:fan')
  })
  it('lets a trigger configured on a thread win over its parent', () => {
    expect(route({ channelId: 'T9', parentId: 'C1', isThread: true })).toBe('channel:on-a-thread')
  })
  it('ignores the bot itself, system messages and other bots in threads', () => {
    expect(route({ isSelf: true })).toBe('ignore')
    expect(route({ isSystem: true })).toBe('ignore')
    expect(route({ channelId: 'T1', parentId: 'C1', isThread: true, authorIsBot: true })).toBe('ignore')
  })
  it('ignores threads under channels without threads, mention triggers, webhook-pinned triggers, or no trigger', () => {
    expect(route({ channelId: 'T1', parentId: 'C2', isThread: true })).toBe('ignore')
    expect(route({ channelId: 'T1', parentId: 'C3', isThread: true })).toBe('ignore')
    expect(route({ channelId: 'T1', parentId: 'C4', isThread: true })).toBe('ignore')
    expect(route({ channelId: 'T1', parentId: 'C8', isThread: true })).toBe('ignore')
    expect(route({ channelId: 'C8' })).toBe('ignore')
  })
})

describe('threadBusy', () => {
  const now = 10_000_000
  it('is busy while a session for that thread is younger than the TTL', () => {
    expect(threadBusy([{ threadId: 'T', startedAt: now - 1000 }], 'T', now, 5000)).toBe(true)
    expect(threadBusy([{ threadId: 'U', startedAt: now - 1000 }], 'T', now, 5000)).toBe(false)
    expect(threadBusy([{ startedAt: now }], 'T', now, 5000)).toBe(false)
  })
  it('lets a lost session expire so the thread is not locked for good', () => {
    expect(threadBusy([{ threadId: 'T', startedAt: now - 5000 }], 'T', now, 5000)).toBe(false)
    expect(threadBusy([{ threadId: 'T', startedAt: now - 4999 }], 'T', now, 5000)).toBe(true)
  })
})

describe('agentAnswer', () => {
  it('keeps only the answer of a completion message', () => {
    const done = '**Session completed** (`996182fa`)\n\n22 calls, double the usual.\n\nView full session: https://c3/sessions/x\nResume in terminal:\n```\ncd ~/x && claude --resume x --dangerously-skip-permissions\n```'
    expect(agentAnswer(done)).toBe('22 calls, double the usual.')
  })
  it('only strips the framing the bot adds, at the start, after trimming', () => {
    expect(agentAnswer('I said On it. Session: earlier')).toBe('I said On it. Session: earlier')
    expect(agentAnswer('note: **Session completed** (`x`) was not mine')).toBe('note: **Session completed** (`x`) was not mine')
    expect(agentAnswer('  On it. Session: https://c3/sessions/x')).toBeNull()
    expect(agentAnswer('**Session completed** (`x`)\n\n\n\nView full session: https://c3/sessions/x')).toBeNull()
  })
  it('drops the On it line and the busy note, and shortens a failure', () => {
    expect(agentAnswer('On it. Session: https://c3/sessions/x')).toBeNull()
    expect(agentAnswer(BUSY_NOTE)).toBeNull()
    expect(agentAnswer(':warning: **Agent session failed** (`x`)\n\n**Reason:** boom')).toBe('(that run failed before answering)')
    expect(agentAnswer('a plain bot post')).toBe('a plain bot post')
  })
})

describe('composeThreadText', () => {
  const opening = { author: 'chip', isBot: false, content: 'how were the calls this week?' }
  const replies = [
    { author: 'Chip Bot', isBot: true, content: 'On it. Session: https://c3/sessions/x' },
    { author: 'Chip Bot', isBot: true, content: '**Session completed** (`x`)\n\n22 calls, double the usual.\n\nView full session: https://c3/sessions/x' },
  ]
  it('carries the conversation, drops the bot noise, ends with the new message', () => {
    expect(composeThreadText(opening, replies, 'chip', 'and last month?')).toBe(
      'Conversation so far in this thread, oldest first:\n\n' +
      'chip: how were the calls this week?\n\nAgent: 22 calls, double the usual.\n\n' +
      'New message from chip in this thread: and last month?',
    )
  })
  it('drops the oldest replies first, keeps the opening, and never exceeds the cap', () => {
    const long = Array.from({ length: 5 }, (_, i) => ({ author: 'Chip Bot', isBot: true, content: `reply ${i} ` + 'x'.repeat(100) }))
    const text = composeThreadText(opening, long, 'chip', 'next?', 400)
    expect(text).toContain('chip: how were the calls this week?')
    expect(text).toContain('(earlier messages left out)')
    expect(text).toContain('reply 4')
    expect(text).not.toContain('reply 0')
    expect(text.length).toBeLessThanOrEqual(400)
  })
  it('holds the cap even when it is small', () => {
    for (const max of [120, 200, 246]) {
      const text = composeThreadText({ author: 'chip', isBot: false, content: 'y'.repeat(900) }, [{ author: 'b', isBot: true, content: 'w'.repeat(900) }], 'chip', 'z'.repeat(900), max)
      expect(text.length).toBeLessThanOrEqual(max)
    }
  })
  it('clips at exactly the limit', () => {
    expect(clip('abcde', 5)).toBe('abcde')
    expect(clip('abcdef', 5)).toBe('abcd…')
  })
  it('clips a huge opening or request instead of overflowing, giving the new message the most room', () => {
    const text = composeThreadText({ author: 'chip', isBot: false, content: 'y'.repeat(5000) }, [], 'chip', 'z'.repeat(5000), 600)
    expect(text.length).toBeLessThanOrEqual(600)
    expect(text.match(/z/g)!.length).toBeGreaterThan(250)
    expect(text.match(/y/g)!.length).toBeLessThan(120)
  })
  it('works without the opening message, without pinning a reply in its place', () => {
    const text = composeThreadText(null, [{ author: 'chip', isBot: false, content: 'earlier' }], 'chip', 'now')
    expect(text).toBe('Conversation so far in this thread, oldest first:\n\nchip: earlier\n\nNew message from chip in this thread: now')
  })
  it('is just the message when there is no history', () => {
    expect(composeThreadText(null, [], 'chip', 'hi')).toBe('New message from chip in this thread: hi')
  })
  it('skips empty messages and trims whitespace', () => {
    const text = composeThreadText({ author: 'chip', isBot: false, content: '  first  ' }, [{ author: 'x', isBot: false, content: '   ' }], 'chip', '  next  ')
    expect(text).toBe('Conversation so far in this thread, oldest first:\n\nchip: first\n\nNew message from chip in this thread: next')
  })
  it('keeps everything that fits exactly', () => {
    const r = [{ author: 'Chip Bot', isBot: true, content: 'b'.repeat(300) }]
    const full = composeThreadText(opening, r, 'chip', 'c', 10000)
    expect(composeThreadText(opening, r, 'chip', 'c', full.length)).toBe(full)
    expect(composeThreadText(opening, r, 'chip', 'c', full.length - 1)).not.toContain('Agent: b')
  })
})
