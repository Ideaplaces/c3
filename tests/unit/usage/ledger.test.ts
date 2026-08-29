import { describe, it, expect } from 'vitest'
import {
  formatOutlier,
  formatSummary,
  isOutlier,
  median,
  recordFromResult,
  summarizeUsage,
  type UsageRecord,
} from '@/lib/usage/ledger'

const meta = { sessionId: 's1', label: 'cron:daily-ops-brief', projectPath: '/p', model: 'claude-opus-5' }

function rec(over: Partial<UsageRecord>): UsageRecord {
  return {
    ts: '2026-08-28T14:00:00.000Z', sessionId: 'x', label: 'cron:daily-ops-brief', projectPath: '/p',
    model: 'm', status: 'success', turns: 10, durationMs: 60_000, inputTokens: 0, cacheCreationTokens: 0,
    cacheReadTokens: 0, outputTokens: 1_000, contextTokens: 400_000, costUsd: 1, ...over,
  }
}

describe('recordFromResult', () => {
  it('sums every model in modelUsage into one context figure', () => {
    const r = recordFromResult(
      {
        subtype: 'success', num_turns: 9, duration_ms: 70_000, total_cost_usd: 1.25,
        modelUsage: {
          'claude-opus-5': { inputTokens: 100, outputTokens: 5_000, cacheReadInputTokens: 300_000, cacheCreationInputTokens: 50_000, costUSD: 1.2 },
          'claude-haiku-4-5': { inputTokens: 900, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
        },
      },
      { ...meta, ts: '2026-08-29T01:00:00.000Z' },
    )
    expect(r.contextTokens).toBe(351_000)
    expect(r.outputTokens).toBe(5_050)
    expect(r.turns).toBe(9)
    expect(r.costUsd).toBe(1.25)
    expect(r.status).toBe('success')
  })

  it('tolerates a result with no modelUsage (crash or startup error)', () => {
    const r = recordFromResult({ subtype: 'error_during_execution', num_turns: 0, duration_ms: 10, total_cost_usd: 0 }, meta)
    expect(r.contextTokens).toBe(0)
    expect(r.status).toBe('error_during_execution')
  })
})

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('isOutlier', () => {
  const history = [1, 2, 3, 4].map((i) => rec({ sessionId: `h${i}`, contextTokens: 400_000 + i * 10_000 }))

  it('flags a run past twice the trailing median of the same label', () => {
    const v = isOutlier(rec({ sessionId: 'new', contextTokens: 4_900_000 }), history)
    expect(v.outlier).toBe(true)
    expect(v.sample).toBe(4)
    expect(v.medianContext).toBe(425_000)
  })

  it('does not flag a run within range, nor one below the floor', () => {
    expect(isOutlier(rec({ sessionId: 'new', contextTokens: 700_000 }), history).outlier).toBe(false)
    const small = [1, 2, 3].map((i) => rec({ sessionId: `s${i}`, contextTokens: 20_000 }))
    expect(isOutlier(rec({ sessionId: 'new', contextTokens: 90_000 }), small).outlier).toBe(false)
  })

  it('needs a baseline: fewer than three prior runs is never an outlier', () => {
    expect(isOutlier(rec({ sessionId: 'new', contextTokens: 9_000_000 }), history.slice(0, 2)).outlier).toBe(false)
  })

  it('compares against the same label only and ignores itself', () => {
    const other = [1, 2, 3].map((i) => rec({ sessionId: `o${i}`, label: 'cron:other', contextTokens: 10_000 }))
    const v = isOutlier(rec({ sessionId: 'new', contextTokens: 4_900_000 }), [...other, rec({ sessionId: 'new', contextTokens: 4_900_000 })])
    expect(v.sample).toBe(0)
    expect(v.outlier).toBe(false)
  })
})

describe('summary', () => {
  it('rolls up per label with the previous window for comparison', () => {
    const now = new Date('2026-08-29T00:00:00.000Z')
    const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
    const records = [
      rec({ sessionId: 'a', ts: day(1), contextTokens: 300_000, turns: 8, costUsd: 1 }),
      rec({ sessionId: 'b', ts: day(2), contextTokens: 500_000, turns: 10, costUsd: 2 }),
      rec({ sessionId: 'c', ts: day(9), contextTokens: 5_000_000, turns: 40, costUsd: 9 }),
      rec({ sessionId: 'd', ts: day(3), label: 'cron:other', contextTokens: 50_000, turns: 3, costUsd: 0.2 }),
    ]
    const rows = summarizeUsage(records, now, 7)
    expect(rows.map((r) => r.label)).toEqual(['cron:daily-ops-brief', 'cron:other'])
    expect(rows[0]).toMatchObject({ runs: 2, medianTurns: 9, medianContext: 400_000, totalContext: 800_000, totalCost: 3, prevTotalContext: 5_000_000 })
    const text = formatSummary(rows, 7, now)
    expect(text).toContain('cron:daily-ops-brief')
    expect(text).toContain('-84%')
    expect(text).toContain('new')
  })

  it('formats an outlier line a human can act on', () => {
    const line = formatOutlier(rec({ sessionId: 'abc', contextTokens: 4_900_000, turns: 44, costUsd: 12.5, durationMs: 360_000 }), { outlier: true, medianContext: 425_000, sample: 4 })
    expect(line).toContain('cron:daily-ops-brief')
    expect(line).toContain('4.9M')
    expect(line).toContain('11.5x')
    expect(line).toContain('$12.50')
    expect(line).toContain('6 min')
  })
})
