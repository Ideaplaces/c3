import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Tests for first/last prompt extraction from real Claude Code JSONL files.
 * Uses realistic session data matching the actual format written by Claude Code CLI.
 */

const TEST_HOME = join(tmpdir(), 'ccc-prompt-test')
const PROJECTS_DIR = join(TEST_HOME, '.claude', 'projects')

// Mock homedir to point to our temp directory, keep tmpdir for test use
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    homedir: vi.fn(() => join(actual.tmpdir(), 'ccc-prompt-test')),
  }
})

import { scanAllSessions, clearCache, entryToSessionMeta } from '@/lib/claude-sessions/scanner'

function setupProjectDir(dirName: string): string {
  const dir = join(PROJECTS_DIR, dirName)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Build a realistic Claude Code JSONL session file.
 * Mirrors the actual format: file-history-snapshot, user (external), assistant,
 * user (tool_result), progress, etc.
 */
function writeRealisticSession(dir: string, sessionId: string, lines: Record<string, unknown>[]) {
  const filePath = join(dir, `${sessionId}.jsonl`)
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  writeFileSync(filePath, content)
  return filePath
}

/** Realistic external user message with text content */
function userMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'user',
    userType: 'external',
    message: { role: 'user', content: [{ type: 'text', text }] },
    cwd: '/home/testuser/myproject',
    gitBranch: 'main',
    timestamp: '2026-03-01T10:00:00.000Z',
    ...extra,
  }
}

/** User message with string content (older format) */
function userMessageString(text: string) {
  return {
    type: 'user',
    userType: 'external',
    message: { role: 'user', content: text },
    cwd: '/home/testuser/myproject',
    gitBranch: 'main',
    timestamp: '2026-03-01T10:00:00.000Z',
  }
}

/** Tool result user message (not a real user prompt) */
function toolResultMessage(toolUseId: string) {
  return {
    type: 'user',
    userType: 'external',
    message: {
      role: 'user',
      content: [
        { tool_use_id: toolUseId, type: 'tool_result', content: 'File written successfully.' },
      ],
    },
    cwd: '/home/testuser/myproject',
    gitBranch: 'main',
    timestamp: '2026-03-01T10:05:00.000Z',
  }
}

/** Assistant message */
function assistantMessage(text: string) {
  return {
    type: 'assistant',
    userType: 'external',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    cwd: '/home/testuser/myproject',
    gitBranch: 'main',
    timestamp: '2026-03-01T10:01:00.000Z',
  }
}

/** File history snapshot (first line of every session) */
function fileHistorySnapshot() {
  return { type: 'file-history-snapshot', fileHistorySnapshot: {} }
}

/** Progress message (large, takes most file space) */
function progressMessage() {
  return {
    type: 'progress',
    userType: 'external',
    data: 'x'.repeat(200),
    timestamp: '2026-03-01T10:03:00.000Z',
  }
}

/** Queue operation */
function queueOperation() {
  return { type: 'queue-operation', operation: 'enqueue' }
}

describe('Scanner prompt extraction with realistic Claude Code JSONL', () => {
  beforeEach(() => {
    try { rmSync(TEST_HOME, { recursive: true }) } catch {}
    mkdirSync(PROJECTS_DIR, { recursive: true })
    clearCache()
  })

  afterEach(() => {
    try { rmSync(TEST_HOME, { recursive: true }) } catch {}
  })

  it('extracts first and last prompts from a realistic session', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    writeRealisticSession(dir, 'session-1', [
      fileHistorySnapshot(),
      userMessage('Help me set up a new React project with TypeScript'),
      assistantMessage('I will help you set up a React project.'),
      toolResultMessage('toolu_01abc'),
      assistantMessage('The project is set up.'),
      progressMessage(),
      progressMessage(),
      userMessage('Now add testing with Vitest'),
      assistantMessage('Adding Vitest configuration.'),
      toolResultMessage('toolu_01def'),
      progressMessage(),
      userMessage('Can you also add ESLint?'),
      assistantMessage('Setting up ESLint.'),
      toolResultMessage('toolu_01ghi'),
    ])

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].firstPrompt).toBe('Help me set up a new React project with TypeScript')
    expect(sessions[0].lastPrompt).toBe('Can you also add ESLint?')
  })

  it('extracts first prompt from string content format', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    writeRealisticSession(dir, 'session-2', [
      fileHistorySnapshot(),
      userMessageString('Fix the login bug'),
      assistantMessage('Looking at the login code.'),
    ])

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].firstPrompt).toBe('Fix the login bug')
  })

  it('skips tool_result messages when finding last prompt', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    // Session ends with many tool_results after the last real user message
    writeRealisticSession(dir, 'session-3', [
      fileHistorySnapshot(),
      userMessage('Deploy the application'),
      assistantMessage('Starting deployment.'),
      toolResultMessage('toolu_01'),
      toolResultMessage('toolu_02'),
      toolResultMessage('toolu_03'),
      assistantMessage('Deployment complete.'),
      toolResultMessage('toolu_04'),
      progressMessage(),
      progressMessage(),
    ])

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].lastPrompt).toBe('Deploy the application')
  })

  it('sets lastPrompt to firstPrompt when session has only one user message', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    writeRealisticSession(dir, 'session-4', [
      fileHistorySnapshot(),
      userMessage('What is the purpose of this codebase?'),
      assistantMessage('This codebase is a web application.'),
    ])

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].firstPrompt).toBe('What is the purpose of this codebase?')
    expect(sessions[0].lastPrompt).toBe('What is the purpose of this codebase?')
  })

  it('handles session with file-history-snapshot, queue-operations, and progress filling most of the file', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    const lines = [
      fileHistorySnapshot(),
      queueOperation(),
      userMessage('Start implementing the API'),
      assistantMessage('Working on the API.'),
    ]
    // Add 20 progress messages (simulates large progress chunks)
    for (let i = 0; i < 20; i++) lines.push(progressMessage())
    lines.push(
      userMessage('Add error handling to all endpoints'),
      assistantMessage('Adding error handling.'),
      toolResultMessage('toolu_99'),
    )
    // More progress at the end
    for (let i = 0; i < 10; i++) lines.push(progressMessage())

    writeRealisticSession(dir, 'session-5', lines)

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].firstPrompt).toBe('Start implementing the API')
    expect(sessions[0].lastPrompt).toBe('Add error handling to all endpoints')
  })

  it('entryToSessionMeta includes both firstPrompt and lastPrompt', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    writeRealisticSession(dir, 'session-6', [
      fileHistorySnapshot(),
      userMessage('First question'),
      assistantMessage('First answer.'),
      userMessage('Second question'),
      assistantMessage('Second answer.'),
    ])

    const sessions = scanAllSessions()
    const meta = entryToSessionMeta(sessions[0])
    expect(meta.firstPrompt).toBe('First question')
    expect(meta.lastPrompt).toBe('Second question')
  })

  it('handles sessions-index.json entries that lack lastPrompt', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    // Write a sessions-index.json in the old format (no lastPrompt field)
    writeFileSync(join(dir, 'sessions-index.json'), JSON.stringify({
      version: 1,
      entries: [{
        sessionId: 'indexed-session',
        fullPath: join(dir, 'indexed-session.jsonl'),
        fileMtime: Date.now(),
        firstPrompt: 'Original first prompt',
        messageCount: 5,
        created: '2026-01-01T00:00:00Z',
        modified: '2026-01-01T01:00:00Z',
        gitBranch: 'main',
        projectPath: '/home/testuser/myproject',
        isSidechain: false,
        // Note: no lastPrompt field (old index format)
      }],
    }))

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    const meta = entryToSessionMeta(sessions[0])
    // Should fall back to firstPrompt when lastPrompt is missing
    expect(meta.firstPrompt).toBe('Original first prompt')
    expect(meta.lastPrompt).toBe('Original first prompt')
  })

  it('extracts metadata from head: cwd, gitBranch, timestamp', () => {
    const dir = setupProjectDir('-home-testuser-myproject')
    writeRealisticSession(dir, 'session-7', [
      fileHistorySnapshot(),
      userMessage('Check the build', {
        cwd: '/home/testuser/special-project',
        gitBranch: 'feature/new-thing',
        timestamp: '2026-02-15T14:30:00.000Z',
      }),
      assistantMessage('Build is clean.'),
    ])

    const sessions = scanAllSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].projectPath).toBe('/home/testuser/special-project')
    expect(sessions[0].gitBranch).toBe('feature/new-thing')
    expect(sessions[0].created).toBe('2026-02-15T14:30:00.000Z')
  })
})
