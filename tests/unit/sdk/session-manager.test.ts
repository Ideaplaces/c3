import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs for session store
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
  readdirSync: vi.fn(() => []),
}))

vi.mock('os', () => ({
  hostname: vi.fn(() => 'test-host'),
  homedir: vi.fn(() => '/tmp/test-ccc'),
}))

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'ccc-uuid-1234'),
}))

vi.mock('@/lib/claude-sessions/scanner', () => ({
  scanAllSessions: vi.fn(() => []),
  findSession: vi.fn(() => undefined),
  getSessionJSONLPath: vi.fn(() => null),
  entryToSessionMeta: vi.fn(),
}))

vi.mock('@/lib/claude-sessions/reader', () => ({
  readSessionJSONL: vi.fn(() => []),
}))

let queryCallArgs: unknown[] = []
let mockMessages: { type: string; session_id: string; [key: string]: unknown }[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn((...args: unknown[]) => {
    queryCallArgs.push(args)
    const messages = [...mockMessages]
    const gen = {
      [Symbol.asyncIterator]() {
        let i = 0
        return {
          async next() {
            if (i < messages.length) return { value: messages[i++], done: false }
            return { value: undefined, done: true }
          },
          async return() { return { value: undefined, done: true } },
          async throw(e: unknown) { throw e },
        }
      },
      streamInput: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
      setModel: vi.fn(),
      setMaxThinkingTokens: vi.fn(),
      initializationResult: vi.fn(),
      supportedCommands: vi.fn(),
      supportedModels: vi.fn(),
      mcpServerStatus: vi.fn(),
      accountInfo: vi.fn(),
      rewindFiles: vi.fn(),
      reconnectMcpServer: vi.fn(),
      toggleMcpServer: vi.fn(),
      setMcpServers: vi.fn(),
      stopTask: vi.fn(),
      next: vi.fn(),
      return: vi.fn(),
      throw: vi.fn(),
    }
    return gen
  }),
}))

import { SessionManager } from '@/lib/sdk/session-manager'
import { getSession } from '@/lib/store/sessions'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    Object.keys(mockFs).forEach((key) => delete mockFs[key])
    queryCallArgs = []
    mockMessages = []
    manager = new SessionManager()
  })

  describe('startSession', () => {
    it('creates a session and passes sessionId to SDK', async () => {
      mockMessages = [
        { type: 'system', subtype: 'init', session_id: 'ccc-uuid-1234', model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', tools: [], cwd: '/test' },
        { type: 'result', subtype: 'success', session_id: 'ccc-uuid-1234', num_turns: 1, total_cost_usd: 0.01, duration_ms: 100, duration_api_ms: 80, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'u1' },
      ]

      const sessionId = await manager.startSession({
        projectPath: '/home/user/project',
        prompt: 'hello',
        permissionMode: 'bypassPermissions',
      })

      expect(sessionId).toBe('ccc-uuid-1234')

      // Verify sessionId was passed to SDK options
      const callArgs = queryCallArgs[0] as [{ options: { sessionId: string } }]
      expect(callArgs[0].options.sessionId).toBe('ccc-uuid-1234')

      await new Promise((r) => setTimeout(r, 50))

      const session = getSession('ccc-uuid-1234')
      expect(session).toBeDefined()
      expect(session!.projectPath).toBe('/home/user/project')
      expect(session!.status).toBe('completed')
    })
  })

  describe('resumeSession', () => {
    it('uses sessionId directly for resume', async () => {
      const { createSession } = await import('@/lib/store/sessions')
      createSession({
        id: 'session-to-resume',
        projectPath: '/home/user/myproject',
        projectName: 'myproject',
        machineName: 'test-host',
        status: 'completed',
        permissionMode: 'bypassPermissions',
        model: 'claude-sonnet-4-6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 1,
        totalCostUsd: 0.05,
        firstPrompt: 'first prompt',
        lastPrompt: 'first prompt',
      })

      mockMessages = [
        { type: 'result', subtype: 'success', session_id: 'session-to-resume', num_turns: 2, total_cost_usd: 0.10, duration_ms: 300, duration_api_ms: 250, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'u3' },
      ]

      queryCallArgs = []
      await manager.resumeSession('session-to-resume', 'follow-up prompt')

      const callArgs = queryCallArgs[0] as [{ prompt: string; options: { resume: string; cwd?: string } }]
      expect(callArgs[0].options.resume).toBe('session-to-resume')
      expect(callArgs[0].options.cwd).toBe('/home/user/myproject')
      expect(callArgs[0].prompt).toBe('follow-up prompt')
    })

    it('restores projectPath from session metadata', async () => {
      const { createSession } = await import('@/lib/store/sessions')
      createSession({
        id: 'path-test',
        projectPath: '/home/user/specific-project',
        projectName: 'specific-project',
        machineName: 'test-host',
        status: 'idle',
        permissionMode: 'default',
        model: 'claude-sonnet-4-6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 1,
        totalCostUsd: 0.01,
        firstPrompt: 'test',
        lastPrompt: 'test',
      })

      mockMessages = [
        { type: 'result', subtype: 'success', session_id: 'path-test', num_turns: 2, total_cost_usd: 0.02, duration_ms: 100, duration_api_ms: 80, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'u5' },
      ]

      queryCallArgs = []
      await manager.resumeSession('path-test', 'resume')

      const callArgs = queryCallArgs[0] as [{ options: { cwd?: string } }]
      expect(callArgs[0].options.cwd).toBe('/home/user/specific-project')
    })
  })

  describe('event buffer', () => {
    it('preserves events across resumes', async () => {
      mockMessages = [
        { type: 'system', subtype: 'init', session_id: 'ccc-uuid-1234', model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', tools: [], cwd: '/test' },
        { type: 'result', subtype: 'success', session_id: 'ccc-uuid-1234', num_turns: 1, total_cost_usd: 0.01, duration_ms: 100, duration_api_ms: 80, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'u6' },
      ]

      const sessionId = await manager.startSession({
        projectPath: '/test',
        prompt: 'first',
        permissionMode: 'bypassPermissions',
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(manager.getBufferedEvents(sessionId).length).toBe(2)

      mockMessages = [
        { type: 'assistant', session_id: 'ccc-uuid-1234', message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] } },
        { type: 'result', subtype: 'success', session_id: 'ccc-uuid-1234', num_turns: 2, total_cost_usd: 0.05, duration_ms: 200, duration_api_ms: 150, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'u7' },
      ]

      await manager.resumeSession(sessionId, 'follow-up')
      await new Promise((r) => setTimeout(r, 50))

      expect(manager.getBufferedEvents(sessionId).length).toBe(4)
    })
  })

  describe('stopSession', () => {
    it('stops an active session', async () => {
      mockMessages = [
        { type: 'system', subtype: 'init', session_id: 'ccc-uuid-1234', model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', tools: [], cwd: '/test' },
      ]

      const sessionId = await manager.startSession({
        projectPath: '/test',
        prompt: 'test',
        permissionMode: 'bypassPermissions',
      })

      expect(manager.isSessionActive(sessionId)).toBe(true)
      manager.stopSession(sessionId)
      expect(manager.isSessionActive(sessionId)).toBe(false)
    })

    it('does nothing for non-existent session', () => {
      manager.stopSession('nonexistent')
    })
  })
})
