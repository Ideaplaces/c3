import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionMeta } from '@/lib/store/types'

// Mock fs before importing the module
const mockFs: Record<string, string> = {}

vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => {
    if (mockFs[path]) return mockFs[path]
    throw new Error('ENOENT')
  }),
  writeFileSync: vi.fn((path: string, data: string) => {
    mockFs[path] = data
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn((path: string) => path in mockFs),
}))

// Import after mocks
import { getAllSessions, getSession, createSession, updateSession, deleteSession } from '@/lib/store/sessions'

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'test-id',
    projectPath: '/home/user/project',
    projectName: 'project',
    machineName: 'lucadev',
    status: 'idle',
    permissionMode: 'bypassPermissions',
    model: 'claude-sonnet-4-6',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    turnCount: 0,
    totalCostUsd: 0,
    lastPrompt: 'hello',
    ...overrides,
  }
}

describe('sessions store', () => {
  beforeEach(() => {
    // Clear mock filesystem
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
})
