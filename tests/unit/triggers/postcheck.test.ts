import { describe, it, expect, beforeEach, vi } from 'vitest'

const { runPrecheck, postDiscordMessage } = vi.hoisted(() => ({
  runPrecheck: vi.fn(),
  postDiscordMessage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/triggers/precheck', () => ({ runPrecheck }))
vi.mock('@/lib/webhooks/discord-mirror', () => ({ postDiscordMessage }))
vi.mock('@/lib/usage', () => ({ USAGE_CHANNEL_ID: 'usage-channel' }))

import { runPostcheck } from '@/lib/triggers/postcheck'

const ending = {
  sessionId: 'abc',
  sessionUrl: 'https://c3.example/sessions/abc',
  startedAt: '2026-10-09T13:35:00.000Z',
  endReason: 'completed',
  events: [],
}

describe('runPostcheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-token')
  })

  it('says so in the usage channel when the postcheck itself fails', async () => {
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 1, reason: 'could not read slack-bot-token', broken: true })
    await runPostcheck('cron:iris-review', 'python3 watchdog.py', '/tmp', ending)
    expect(postDiscordMessage).toHaveBeenCalledWith(
      'discord-token',
      'usage-channel',
      '**C3 postcheck failed** `cron:iris-review`: exit 1, could not read slack-bot-token. ' +
        'If the run itself died, nothing said so. Session: https://c3.example/sessions/abc',
    )
  })

  it('posts nothing when the postcheck succeeds', async () => {
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: 'the run posted to the channel' })
    await runPostcheck('cron:iris-review', 'python3 watchdog.py', '/tmp', ending)
    expect(postDiscordMessage).not.toHaveBeenCalled()
  })
})
