import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const posted = vi.hoisted(() => ({ message: vi.fn(), chunked: vi.fn() }))
vi.mock('@/lib/webhooks/discord-mirror', () => ({ postDiscordMessage: posted.message, postDiscordChunked: posted.chunked }))

import { recordSessionEndedWithoutResult, startUsageTracking, trackAssistantUsage } from '@/lib/usage'

/**
 * Chip, 2026-10-19: every C3 post is one he has to act on. A run over its usage line needs no
 * hand (C3 caps duration and stalls), so the alert, its closing line and the outlier note go to
 * the log. On 2026-10-18 one superfan run posted four of them in twenty minutes.
 */
describe('usage alerts', () => {
  const before = { config: process.env.C3_CONFIG_DIR, token: process.env.DISCORD_BOT_TOKEN }
  beforeEach(() => {
    process.env.C3_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'c3-usage-'))
    process.env.DISCORD_BOT_TOKEN = 'token'
    posted.message.mockReset()
    posted.chunked.mockReset()
  })
  afterEach(() => {
    if (before.config === undefined) delete process.env.C3_CONFIG_DIR
    else process.env.C3_CONFIG_DIR = before.config
    if (before.token === undefined) delete process.env.DISCORD_BOT_TOKEN
    else process.env.DISCORD_BOT_TOKEN = before.token
  })

  it('log a run over its line and its ending, and post nothing to Discord', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    startUsageTracking('s-big', 'cron:superfan-tour-safari')
    await trackAssistantUsage('s-big', { input_tokens: 1000, cache_read_input_tokens: 3_500_000, output_tokens: 300 })
    await trackAssistantUsage('s-big', { input_tokens: 1000, cache_read_input_tokens: 7_500_000, output_tokens: 300 })
    await recordSessionEndedWithoutResult('s-big', 'max-duration-exceeded', { label: 'cron:superfan-tour-safari', projectPath: '/p', model: 'm', durationMs: 1 })
    expect(posted.message).not.toHaveBeenCalled()
    expect(posted.chunked).not.toHaveBeenCalled()
    expect(warn.mock.calls.filter(([m]) => String(m).startsWith('[Usage]')).length).toBe(3)
    warn.mockRestore()
  })
})
