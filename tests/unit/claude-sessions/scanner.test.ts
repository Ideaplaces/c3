import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFs: Record<string, string> = {}
const mockDirs: Record<string, string[]> = {}
const mockStats: Record<string, { mtimeMs: number; birthtime: Date }> = {}

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => path in mockFs || path in mockDirs),
  readFileSync: vi.fn((path: string) => {
    if (mockFs[path]) return mockFs[path]
    throw new Error('ENOENT')
  }),
  readdirSync: vi.fn((path: string) => mockDirs[path] || []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn((path: string) => mockStats[path] || { mtimeMs: 1700000000000, birthtime: new Date('2026-01-01T00:00:00Z'), isDirectory: () => true }),
  openSync: vi.fn(() => 99),
  readSync: vi.fn((_fd: number, buffer: Buffer, _offset: number, _length: number, _position: number) => {
    // readSync doesn't know the path, but we only use it after openSync
    // The mock returns 0 bytes by default; tests that need JSONL content use mockFs + readFileSync via index
    return 0
  }),
  closeSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

import { scanAllSessions, findSession, getSessionJSONLPath, entryToSessionMeta, clearCache } from '@/lib/claude-sessions/scanner'

describe('Claude sessions scanner', () => {
  beforeEach(() => {
    Object.keys(mockFs).forEach((k) => delete mockFs[k])
    Object.keys(mockDirs).forEach((k) => delete mockDirs[k])
    Object.keys(mockStats).forEach((k) => delete mockStats[k])
    clearCache()
  })

  it('returns empty array when projects dir does not exist', () => {
    const sessions = scanAllSessions()
    expect(sessions).toEqual([])
  })

  it('scans sessions-index.json files across project dirs', () => {
    const projectsDir = '/home/testuser/.claude/projects'
    mockDirs[projectsDir] = ['-home-testuser-myproject']
    mockDirs[`${projectsDir}/-home-testuser-myproject`] = ['sessions-index.json', 'abc-123.jsonl']

    const indexPath = `${projectsDir}/-home-testuser-myproject/sessions-index.json`
    mockFs[indexPath] = JSON.stringify({
      version: 1,
      entries: [
        {
          sessionId: 'abc-123',
          fullPath: `${projectsDir}/-home-testuser-myproject/abc-123.jsonl`,
          fileMtime: 1700000000000,
          firstPrompt: 'hello world',
          messageCount: 10,
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T01:00:00.000Z',
          gitBranch: 'main',
          projectPath: '/home/testuser/myproject',
          isSidechain: false,
        },
      ],
    })

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('abc-123')
    expect(sessions[0].projectPath).toBe('/home/testuser/myproject')
    expect(sessions[0].firstPrompt).toBe('hello world')
  })

  it('filters out sidechain sessions', () => {
    const projectsDir = '/home/testuser/.claude/projects'
    mockDirs[projectsDir] = ['-home-testuser-proj']
    mockDirs[`${projectsDir}/-home-testuser-proj`] = ['sessions-index.json', 'main-1.jsonl', 'side-1.jsonl']

    mockFs[`${projectsDir}/-home-testuser-proj/sessions-index.json`] = JSON.stringify({
      version: 1,
      entries: [
        { sessionId: 'main-1', isSidechain: false, firstPrompt: 'main', messageCount: 5, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T01:00:00Z', projectPath: '/p', gitBranch: 'main', fullPath: '', fileMtime: 0 },
        { sessionId: 'side-1', isSidechain: true, firstPrompt: 'side', messageCount: 3, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:30:00Z', projectPath: '/p', gitBranch: 'main', fullPath: '', fileMtime: 0 },
      ],
    })

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('main-1')
  })

  it('sorts sessions by modified date descending', () => {
    const projectsDir = '/home/testuser/.claude/projects'
    mockDirs[projectsDir] = ['-home-testuser-proj']
    mockDirs[`${projectsDir}/-home-testuser-proj`] = ['sessions-index.json', 'old.jsonl', 'new.jsonl']

    mockFs[`${projectsDir}/-home-testuser-proj/sessions-index.json`] = JSON.stringify({
      version: 1,
      entries: [
        { sessionId: 'old', isSidechain: false, firstPrompt: 'old', messageCount: 5, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', projectPath: '/p', gitBranch: 'main', fullPath: '', fileMtime: 0 },
        { sessionId: 'new', isSidechain: false, firstPrompt: 'new', messageCount: 5, created: '2026-01-02T00:00:00Z', modified: '2026-01-02T00:00:00Z', projectPath: '/p', gitBranch: 'main', fullPath: '', fileMtime: 0 },
      ],
    })

    const sessions = scanAllSessions()
    expect(sessions[0].sessionId).toBe('new')
    expect(sessions[1].sessionId).toBe('old')
  })

  it('merges sessions from multiple project directories', () => {
    const projectsDir = '/home/testuser/.claude/projects'
    mockDirs[projectsDir] = ['-home-testuser-proj1', '-home-testuser-proj2']
    mockDirs[`${projectsDir}/-home-testuser-proj1`] = ['sessions-index.json', 'p1-s1.jsonl']
    mockDirs[`${projectsDir}/-home-testuser-proj2`] = ['sessions-index.json', 'p2-s1.jsonl']

    mockFs[`${projectsDir}/-home-testuser-proj1/sessions-index.json`] = JSON.stringify({
      version: 1,
      entries: [
        { sessionId: 'p1-s1', isSidechain: false, firstPrompt: 'p1', messageCount: 5, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', projectPath: '/p1', gitBranch: 'main', fullPath: '', fileMtime: 0 },
      ],
    })

    mockFs[`${projectsDir}/-home-testuser-proj2/sessions-index.json`] = JSON.stringify({
      version: 1,
      entries: [
        { sessionId: 'p2-s1', isSidechain: false, firstPrompt: 'p2', messageCount: 3, created: '2026-01-02T00:00:00Z', modified: '2026-01-02T00:00:00Z', projectPath: '/p2', gitBranch: 'main', fullPath: '', fileMtime: 0 },
      ],
    })

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(2)
  })

  it('skips corrupted index files', () => {
    const projectsDir = '/home/testuser/.claude/projects'
    mockDirs[projectsDir] = ['-home-testuser-bad']
    mockDirs[`${projectsDir}/-home-testuser-bad`] = ['sessions-index.json']

    mockFs[`${projectsDir}/-home-testuser-bad/sessions-index.json`] = '{not valid json'

    const sessions = scanAllSessions()
    expect(sessions).toEqual([])
  })

  describe('findSession', () => {
    it('finds a session by ID', () => {
      const projectsDir = '/home/testuser/.claude/projects'
      mockDirs[projectsDir] = ['-home-testuser-proj']
      mockDirs[`${projectsDir}/-home-testuser-proj`] = ['sessions-index.json', 'target-id.jsonl']
      mockFs[`${projectsDir}/-home-testuser-proj/sessions-index.json`] = JSON.stringify({
        version: 1,
        entries: [
          { sessionId: 'target-id', isSidechain: false, firstPrompt: 'found', messageCount: 5, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', projectPath: '/p', gitBranch: 'main', fullPath: '', fileMtime: 0 },
        ],
      })

      const session = findSession('target-id')
      expect(session).toBeDefined()
      expect(session!.firstPrompt).toBe('found')
    })

    it('returns undefined for unknown session', () => {
      const projectsDir = '/home/testuser/.claude/projects'
      mockDirs[projectsDir] = []
      expect(findSession('nonexistent')).toBeUndefined()
    })
  })

  describe('getSessionJSONLPath', () => {
    it('finds JSONL file across project dirs', () => {
      const projectsDir = '/home/testuser/.claude/projects'
      mockDirs[projectsDir] = ['-home-testuser-proj']

      const jsonlPath = `${projectsDir}/-home-testuser-proj/abc-123.jsonl`
      mockFs[jsonlPath] = 'content'

      const result = getSessionJSONLPath('abc-123')
      expect(result).toBe(jsonlPath)
    })

    it('returns null when not found', () => {
      const projectsDir = '/home/testuser/.claude/projects'
      mockDirs[projectsDir] = ['-home-testuser-proj']

      expect(getSessionJSONLPath('nonexistent')).toBeNull()
    })
  })

  describe('entryToSessionMeta', () => {
    it('converts index entry to SessionMeta', () => {
      const entry = {
        sessionId: 'test-id',
        fullPath: '/path/to/test-id.jsonl',
        fileMtime: 1700000000000,
        firstPrompt: 'hello world',
        lastPrompt: 'goodbye world',
        messageCount: 10,
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T01:00:00Z',
        gitBranch: 'main',
        projectPath: '/home/testuser/myproject',
        isSidechain: false,
      }

      const meta = entryToSessionMeta(entry)
      expect(meta.id).toBe('test-id')
      expect(meta.projectName).toBe('myproject')
      expect(meta.firstPrompt).toBe('hello world')
      expect(meta.lastPrompt).toBe('goodbye world')
      expect(meta.turnCount).toBe(10)
      expect(meta.status).toBe('completed')
      expect(meta.createdAt).toBe('2026-01-01T00:00:00Z')
    })
  })
})
