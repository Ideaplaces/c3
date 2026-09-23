import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { recordSessionEndedWithoutResult, startUsageTracking, trackAssistantUsage } from '@/lib/usage'

/**
 * A run the session manager ends (max-duration-exceeded, a stall) or a
 * generator that throws never sends a result, and until 2026-09-23 left no
 * line in the ledger: the faro-review run that posted its report and opened
 * its pull request that morning was ended at 30 minutes and vanished from the
 * rollup. The live tracker knows the turns and the tokens; this writes them.
 */
describe('a run that ends without a result', () => {
  let dir: string
  const before = { config: process.env.C3_CONFIG_DIR, token: process.env.DISCORD_BOT_TOKEN }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'c3-usage-'))
    process.env.C3_CONFIG_DIR = dir
    delete process.env.DISCORD_BOT_TOKEN
  })
  afterEach(() => {
    if (before.config === undefined) delete process.env.C3_CONFIG_DIR
    else process.env.C3_CONFIG_DIR = before.config
    if (before.token !== undefined) process.env.DISCORD_BOT_TOKEN = before.token
  })
  const lines = () => {
    const f = join(dir, 'state', 'usage.jsonl')
    return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  }

  it('writes the turns and tokens counted so far, with the reason as the status, once', async () => {
    startUsageTracking('s-ended', 'cron:faro-review')
    await trackAssistantUsage('s-ended', { input_tokens: 1000, cache_read_input_tokens: 20_000, output_tokens: 300 })
    await trackAssistantUsage('s-ended', { input_tokens: 500, cache_creation_input_tokens: 4000, output_tokens: 200 })
    await recordSessionEndedWithoutResult('s-ended', 'max-duration-exceeded', { label: 'cron:faro-review', projectPath: '/p', model: 'claude-opus-5', durationMs: 1_827_000 })
    expect(lines()).toEqual([
      expect.objectContaining({
        sessionId: 's-ended',
        label: 'cron:faro-review',
        status: 'ended: max-duration-exceeded',
        turns: 2,
        contextTokens: 25_500,
        outputTokens: 500,
        durationMs: 1_827_000,
        costUsd: 0,
      }),
    ])
    // The self-heal path and the generator's catch can both reach this; the second is a no-op.
    await recordSessionEndedWithoutResult('s-ended', 'stalled', { label: 'cron:faro-review', projectPath: '/p', model: 'claude-opus-5', durationMs: 1_900_000 })
    expect(lines()).toHaveLength(1)
  })

  it('writes nothing for a session it never tracked, and nothing for one that already has its result line', async () => {
    await recordSessionEndedWithoutResult('s-unknown', 'stalled', { label: 'web', projectPath: '/p', model: 'm', durationMs: 10 })
    expect(lines()).toEqual([])
  })
})
