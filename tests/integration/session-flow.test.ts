import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  hostname: vi.fn(() => 'integration-host'),
  homedir: vi.fn(() => '/tmp/test-ccc-integration'),
}))

let uuidCounter = 0
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `ccc-int-${++uuidCounter}`),
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

let messageQueues: { type: string; session_id: string; [key: string]: unknown }[][] = []
let queueIndex = 0

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const messages = messageQueues[queueIndex] || []
    queueIndex++
    return {
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
  }),
}))

import { SessionManager } from '@/lib/sdk/session-manager'
import { getSession } from '@/lib/store/sessions'
import { query } from '@anthropic-ai/claude-agent-sdk'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('session flow integration', () => {
  let manager: SessionManager

  beforeEach(() => {
    Object.keys(mockFs).forEach((key) => delete mockFs[key])
    uuidCounter = 0
    messageQueues = []
    queueIndex = 0
    manager = new SessionManager()
  })

  it('full lifecycle: start -> complete -> resume', async () => {
    messageQueues[0] = [
      { type: 'system', subtype: 'init', session_id: 'ccc-int-1', model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', tools: [], cwd: '/home/user/project' },
      { type: 'assistant', session_id: 'ccc-int-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Response' }] } },
      { type: 'result', subtype: 'success', session_id: 'ccc-int-1', num_turns: 1, total_cost_usd: 0.05, duration_ms: 500, duration_api_ms: 400, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'msg-1' },
    ]

    messageQueues[1] = [
      { type: 'assistant', session_id: 'ccc-int-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Follow-up' }] } },
      { type: 'result', subtype: 'success', session_id: 'ccc-int-1', num_turns: 2, total_cost_usd: 0.10, duration_ms: 400, duration_api_ms: 300, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'msg-2' },
    ]

    const sessionId = await manager.startSession({
      projectPath: '/home/user/project',
      prompt: 'first prompt',
      permissionMode: 'bypassPermissions',
    })

    await wait(100)

    expect(getSession(sessionId)!.status).toBe('completed')
    expect(getSession(sessionId)!.totalCostUsd).toBe(0.05)
    expect(manager.getBufferedEvents(sessionId).length).toBe(3)

    // Resume uses sessionId directly (CCC and SDK share the same ID)
    await manager.resumeSession(sessionId, 'follow-up')

    const queryMock = query as ReturnType<typeof vi.fn>
    const resumeCall = queryMock.mock.calls[1]
    expect(resumeCall[0].options.resume).toBe(sessionId)
    expect(resumeCall[0].options.cwd).toBe('/home/user/project')

    await wait(100)

    expect(getSession(sessionId)!.totalCostUsd).toBe(0.10)
    expect(manager.getBufferedEvents(sessionId).length).toBe(5)
  })

  it('emits events in correct order', async () => {
    messageQueues[0] = [
      { type: 'system', subtype: 'init', session_id: 'ccc-int-1', model: 'claude-sonnet-4-6', permissionMode: 'default', tools: [], cwd: '/test' },
      { type: 'result', subtype: 'success', session_id: 'ccc-int-1', num_turns: 1, total_cost_usd: 0.01, duration_ms: 100, duration_api_ms: 80, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'e1' },
    ]

    const events: string[] = []
    manager.on('sdk_event', () => events.push('sdk_event'))
    manager.on('session_ended', () => events.push('session_ended'))

    await manager.startSession({ projectPath: '/test', prompt: 'test', permissionMode: 'default' })
    await wait(100)

    expect(events).toEqual(['sdk_event', 'sdk_event', 'session_ended'])
  })

  it('handles error sessions', async () => {
    messageQueues[0] = [
      { type: 'system', subtype: 'init', session_id: 'ccc-int-1', model: 'claude-sonnet-4-6', permissionMode: 'default', tools: [], cwd: '/test' },
      { type: 'result', subtype: 'error_during_execution', session_id: 'ccc-int-1', num_turns: 0, total_cost_usd: 0.001, duration_ms: 50, duration_api_ms: 30, is_error: true, stop_reason: null, usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], errors: ['Something went wrong'], uuid: 'err1' },
    ]

    const sessionId = await manager.startSession({ projectPath: '/test', prompt: 'test', permissionMode: 'default' })
    await wait(100)

    expect(getSession(sessionId)!.status).toBe('error')
    expect(getSession(sessionId)!.errorMessage).toBe('Something went wrong')
  })
})
