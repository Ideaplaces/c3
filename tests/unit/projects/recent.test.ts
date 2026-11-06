import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rankWorkspaces, readLedgerRuns } from '@/lib/projects/recent'

const ideaplaces = { name: 'ideaplaces-meta', path: '/home/u/ideaplaces-meta' }
const mentorly = { name: 'mentorly-meta', path: '/home/u/mentorly-meta' }
const eli = { name: 'eli.health-meta', path: '/home/u/eli.health-meta' }
const NOW = Date.parse('2026-11-06T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86400000).toISOString()

describe('rankWorkspaces', () => {
  it('puts the busiest workspace first, counting runs in its repos', () => {
    const runs = [
      { ts: day(1), projectPath: '/home/u/eli.health-meta' },
      { ts: day(2), projectPath: '/home/u/eli.health-meta/eli-kpi' },
      { ts: day(3), projectPath: '/home/u/mentorly-meta' },
    ]
    expect(rankWorkspaces([ideaplaces, mentorly, eli], runs, NOW).map((w) => w.name))
      .toEqual(['eli.health-meta', 'mentorly-meta', 'ideaplaces-meta'])
  })

  it('ignores runs older than 30 days and paths that only share a prefix', () => {
    const runs = [
      { ts: day(31), projectPath: '/home/u/eli.health-meta' },
      { ts: day(31), projectPath: '/home/u/eli.health-meta' },
      { ts: day(1), projectPath: '/home/u/mentorly-meta-old' },
      { ts: day(1), projectPath: '/home/u/ideaplaces-meta' },
      { ts: day(29), projectPath: '/home/u/mentorly-meta' },
    ]
    expect(rankWorkspaces([eli, mentorly, ideaplaces], runs, NOW).map((w) => w.name))
      .toEqual(['mentorly-meta', 'ideaplaces-meta', 'eli.health-meta'])
  })

  it('ranks folders started by hand above busy agent folders, and ignores skipped and future runs', () => {
    const runs = [
      ...Array.from({ length: 50 }, () => ({ ts: day(1), projectPath: '/home/u/eli.health-meta', label: 'cron:x' })),
      ...Array.from({ length: 90 }, () => ({ ts: day(1), projectPath: '/home/u/ideaplaces-meta', label: 'cron:y', status: 'skipped: nothing new' })),
      { ts: day(-2), projectPath: '/home/u/ideaplaces-meta', label: 'web' },
      { ts: day(2), projectPath: '/home/u/mentorly-meta', label: 'web' },
      { ts: day(3), projectPath: '/home/u/ideaplaces-meta', label: 'cron:y', status: 'completed' },
    ]
    expect(rankWorkspaces([ideaplaces, eli, mentorly], runs, NOW).map((w) => w.name))
      .toEqual(['mentorly-meta', 'eli.health-meta', 'ideaplaces-meta'])
  })

  it('credits a run to the nested workspace, not its parent', () => {
    const home = { name: 'u', path: '/home/u' }
    const runs = [
      { ts: day(1), projectPath: '/home/u/mentorly-meta/app' },
      { ts: day(1), projectPath: '/home/u/mentorly-meta' },
      { ts: day(1), projectPath: '/home/u/scratch' },
    ]
    expect(rankWorkspaces([home, mentorly], runs, NOW).map((w) => w.name)).toEqual(['mentorly-meta', 'u'])
  })
})

describe('readLedgerRuns', () => {
  it('reads ts and projectPath, skipping torn and incomplete lines', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'c3-ledger-')), 'usage.jsonl')
    writeFileSync(file, [
      JSON.stringify({ ts: '2026-11-01T00:00:00Z', projectPath: '/a', label: 'cron:x', status: 'skipped: idle', costUsd: 1 }),
      '{"ts": "2026-11-0',
      JSON.stringify({ ts: '2026-11-02T00:00:00Z' }),
      JSON.stringify({ ts: '2026-11-03T00:00:00Z', projectPath: '/b' }),
      '',
    ].join('\n'))
    expect(readLedgerRuns(file)).toEqual([
      { ts: '2026-11-01T00:00:00Z', projectPath: '/a', label: 'cron:x', status: 'skipped: idle' },
      { ts: '2026-11-03T00:00:00Z', projectPath: '/b', label: undefined, status: undefined },
    ])
  })

  it('returns nothing when the ledger does not exist', () => {
    expect(readLedgerRuns('/nonexistent/usage.jsonl')).toEqual([])
  })
})
