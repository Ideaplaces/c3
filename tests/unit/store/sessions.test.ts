import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionMeta } from '@/lib/store/types'

// Mock fs before importing the module
const mockFs: Record<string, string> = {}

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  readFileSync: vi.fn((path: string) => {
    if (mockFs[path]) return mockFs[path]
    throw new Error('ENOENT')
  }),
  writeFileSync: vi.fn((path: string, data: string) => {
    mockFs[path] = data
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn((path: string) => path in mockFs),
  statSync: vi.fn((path: string) => ({ mtimeMs: 0, size: mockFs[path]?.length ?? 0 })),
  readdirSync: vi.fn(() => []),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

// Mock the claude-sessions scanner (getAllSessions uses it)
vi.mock('@/lib/claude-sessions/scanner', () => ({
  scanAllSessions: vi.fn(() => []),
  findSession: vi.fn(() => undefined),
  entryToSessionMeta: vi.fn(),
}))

// Import after mocks
import { getAllSessions, getSession, createSession, updateSession, deleteSession, listSessions } from '@/lib/store/sessions'

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'test-id',
    projectPath: '/home/user/project',
    projectName: 'project',
    machineName: 'dev-machine',
    status: 'idle',
    permissionMode: 'bypassPermissions',
    model: 'claude-sonnet-4-6',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    turnCount: 0,
    totalCostUsd: 0,
    firstPrompt: 'hello',
    lastPrompt: 'hello',
    ...overrides,
  }
}

describe('sessions store', () => {
  beforeEach(() => {
    Object.keys(mockFs).forEach((key) => delete mockFs[key])
  })

  it('returns empty array when no sessions file', () => {
    const sessions = getAllSessions()
    expect(sessions).toEqual([])
  })

  it('creates and retrieves a session', () => {
    const session = makeSession()
    createSession(session)
    const result = getSession('test-id')
    expect(result).toBeDefined()
    expect(result!.id).toBe('test-id')
    expect(result!.projectName).toBe('project')
  })

  it('updates a session', () => {
    createSession(makeSession())
    const updated = updateSession('test-id', { status: 'running', turnCount: 5 })
    expect(updated).toBeDefined()
    expect(updated!.status).toBe('running')
    expect(updated!.turnCount).toBe(5)
  })

  it('returns undefined when updating non-existent session', () => {
    const updated = updateSession('nope', { status: 'running' })
    expect(updated).toBeUndefined()
  })

  it('deletes a session', () => {
    createSession(makeSession())
    const deleted = deleteSession('test-id')
    expect(deleted).toBe(true)
    expect(getSession('test-id')).toBeUndefined()
  })

  it('returns false when deleting non-existent session', () => {
    expect(deleteSession('nope')).toBe(false)
  })

  it('sorts sessions by updatedAt descending', () => {
    createSession(makeSession({ id: 'old', updatedAt: '2025-01-01T00:00:00.000Z' }))
    createSession(makeSession({ id: 'new', updatedAt: '2025-06-01T00:00:00.000Z' }))
    const sessions = getAllSessions()
    expect(sessions[0].id).toBe('new')
    expect(sessions[1].id).toBe('old')
  })

  describe('listSessions', () => {
    it('lists only sessions started from the page, newest first, cut to the limit', () => {
      createSession(makeSession({ id: 'cron-run', source: 'cron:digby', updatedAt: '2025-01-05T00:00:00.000Z' }))
      createSession(makeSession({ id: 'old-web', source: 'web', updatedAt: '2025-01-01T00:00:00.000Z' }))
      createSession(makeSession({ id: 'legacy', updatedAt: '2025-01-04T00:00:00.000Z' }))
      createSession(makeSession({ id: 'mid-web', source: 'web', updatedAt: '2025-01-02T00:00:00.000Z' }))
      createSession(makeSession({ id: 'new-web', source: 'web', updatedAt: '2025-01-03T00:00:00.000Z' }))

      expect(listSessions({ scope: 'web', limit: 2 }).map((s) => s.id)).toEqual(['new-web', 'mid-web'])
    })

    it('includes agent runs and native Claude Code sessions in the all scope', async () => {
      const scanner = await import('@/lib/claude-sessions/scanner')
      vi.mocked(scanner.scanAllSessions).mockReturnValueOnce([{ sessionId: 'native' }] as never)
      vi.mocked(scanner.entryToSessionMeta).mockImplementationOnce(() => makeSession({ id: 'native' }) as never)
      createSession(makeSession({ id: 'cron-run', source: 'cron:digby' }))
      createSession(makeSession({ id: 'web-run', source: 'web' }))

      expect(listSessions({ scope: 'all', limit: 50 }).map((s) => s.id).sort()).toEqual(['cron-run', 'native', 'web-run'])
    })

    it('cuts prompts to a 200 character preview', () => {
      const first = 'a'.repeat(200) + 'b'.repeat(4800)
      const last = 'c'.repeat(200) + 'd'.repeat(4800)
      createSession(makeSession({ source: 'web', firstPrompt: first, lastPrompt: last }))

      const [s] = listSessions({ scope: 'web', limit: 50 })
      expect(s.firstPrompt).toBe('a'.repeat(200))
      expect(s.lastPrompt).toBe('c'.repeat(200))
    })
  })
})
