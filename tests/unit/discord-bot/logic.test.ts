import { describe, it, expect } from 'vitest'
import {
  selectTriggersForBot,
  shouldFire,
  extractDiscordText,
  threadNameFor,
  formatSessionResult,
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
