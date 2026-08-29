import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDirs: Record<string, string[]> = {}
const mockStats: Record<string, { mtimeMs: number }> = {}

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn((path: string) => path in mockStats || path in mockDirs),
  readdirSync: vi.fn((path: string) => {
    if (path in mockDirs) return mockDirs[path]
    throw new Error('ENOENT')
  }),
  statSync: vi.fn((path: string) => {
    if (path in mockStats) return mockStats[path]
    throw new Error('ENOENT')
  }),
  readFileSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}))

import { getSessionLastActivityMs } from '@/lib/claude-sessions/scanner'

const HOME = process.env.HOME || '/home/chipdev'
const PROJECTS = `${HOME}/.claude/projects`
const PROJECT = 'proj'
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JSONL = `${PROJECTS}/${PROJECT}/${SID}.jsonl`
const SUBAGENTS = `${PROJECTS}/${PROJECT}/${SID}/subagents`

beforeEach(() => {
  for (const k of Object.keys(mockDirs)) delete mockDirs[k]
  for (const k of Object.keys(mockStats)) delete mockStats[k]
  mockDirs[PROJECTS] = [PROJECT]
})

describe('getSessionLastActivityMs', () => {
  it('uses the session transcript when there are no subagents', () => {
    mockStats[JSONL] = { mtimeMs: 1_000 }

    expect(getSessionLastActivityMs(SID)).toBe(1_000)
  })

  it('counts a subagent still writing as activity', () => {
    // The exact shape of the support session the watchdog killed: the parent
    // transcript had been idle for 125s while the subagent wrote 2s ago.
    const now = 1_000_000
    mockStats[JSONL] = { mtimeMs: now - 125_000 }
    mockDirs[SUBAGENTS] = ['agent-a7ac227f40fdce32f.jsonl']
    mockStats[`${SUBAGENTS}/agent-a7ac227f40fdce32f.jsonl`] = { mtimeMs: now - 2_000 }

    const idleMs = now - (getSessionLastActivityMs(SID) as number)

    expect(idleMs).toBe(2_000)
    // Under the 90s recovery threshold, so the watchdog leaves it alone.
    expect(idleMs).toBeLessThan(90_000)
  })

  it('takes the newest subagent when several ran', () => {
    mockStats[JSONL] = { mtimeMs: 10 }
    mockDirs[SUBAGENTS] = ['agent-one.jsonl', 'agent-two.jsonl']
    mockStats[`${SUBAGENTS}/agent-one.jsonl`] = { mtimeMs: 500 }
    mockStats[`${SUBAGENTS}/agent-two.jsonl`] = { mtimeMs: 900 }

    expect(getSessionLastActivityMs(SID)).toBe(900)
  })

  it('still reports a genuinely idle session as idle', () => {
    // Subagent finished long ago and nothing has written since: this one really
    // is hung and must still be recovered.
    mockStats[JSONL] = { mtimeMs: 1_000 }
    mockDirs[SUBAGENTS] = ['agent-done.jsonl']
    mockStats[`${SUBAGENTS}/agent-done.jsonl`] = { mtimeMs: 2_000 }

    expect(getSessionLastActivityMs(SID)).toBe(2_000)
  })

  it('ignores a subagent file that cannot be read', () => {
    mockStats[JSONL] = { mtimeMs: 4_000 }
    mockDirs[SUBAGENTS] = ['vanished.jsonl']

    expect(getSessionLastActivityMs(SID)).toBe(4_000)
  })

  it('returns null when the session has no transcript yet', () => {
    expect(getSessionLastActivityMs(SID)).toBeNull()
  })
})
