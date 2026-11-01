import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fs for session store
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
  getSessionLastActivityMs: vi.fn(() => null),
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

    it('pins the default model in the SDK options when the caller specifies none', async () => {
      const { DEFAULT_MODEL } = await import('@/lib/models')
      mockMessages = [
        { type: 'system', subtype: 'init', session_id: 'ccc-uuid-1234', model: DEFAULT_MODEL, permissionMode: 'bypassPermissions', tools: [], cwd: '/test' },
      ]

      await manager.startSession({
        projectPath: '/home/user/project',
        prompt: 'hello',
        permissionMode: 'bypassPermissions',
      })

      const callArgs = queryCallArgs[0] as [{ options: { model: string } }]
      expect(callArgs[0].options.model).toBe(DEFAULT_MODEL)
      expect(DEFAULT_MODEL).toBe('claude-opus-5-5[1m]')

      await new Promise((r) => setTimeout(r, 50))
      expect(getSession('ccc-uuid-1234')!.model).toBe(DEFAULT_MODEL)
    })

    it('honours an explicit model over the default', async () => {
      mockMessages = [
        { type: 'system', subtype: 'init', session_id: 'ccc-uuid-1234', model: 'claude-fable-5', permissionMode: 'bypassPermissions', tools: [], cwd: '/test' },
      ]

      await manager.startSession({
        projectPath: '/home/user/project',
        prompt: 'hello',
        permissionMode: 'bypassPermissions',
        model: 'claude-fable-5',
      })

      const callArgs = queryCallArgs[0] as [{ options: { model: string } }]
      expect(callArgs[0].options.model).toBe('claude-fable-5')

      await new Promise((r) => setTimeout(r, 50))
      expect(getSession('ccc-uuid-1234')!.model).toBe('claude-fable-5')
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

  describe('resumeSession as a trigger (a Discord thread follow-up)', () => {
    const answer = (text: string) => ({ type: 'assistant', session_id: 's', message: { content: [{ type: 'text', text }] } })

    it('pins the model and keeps the label and duration cap of the trigger', async () => {
      mockMessages = []
      // Read the active entry before the (empty) run ends and cleans it up.
      const running = manager.resumeSession('s', 'more', { label: 'discord:superfan-tour-calls', maxDurationMs: 1234, model: 'claude-opus-5-5[1m]' })
      const active = manager.getActiveSession('s') as { label: string; maxDurationMs?: number } | undefined
      await running
      const opts = (queryCallArgs[0] as [{ options: { model?: string; resume: string } }])[0].options
      expect(opts.model).toBe('claude-opus-5-5[1m]')
      expect(opts.resume).toBe('s')
      expect(active?.label).toBe('discord:superfan-tour-calls')
      expect(active?.maxDurationMs).toBe(1234)
    })

    it('reads only the current run, not the earlier answers in the same session', async () => {
      mockMessages = [answer('first answer')]
      await manager.resumeSession('s', 'one')
      await new Promise(r => setTimeout(r, 30))
      mockMessages = [answer('second answer')]
      await manager.resumeSession('s', 'two')
      await new Promise(r => setTimeout(r, 30))
      const texts = manager.getRunEvents('s').map(e => JSON.stringify(e.message))
      expect(texts.join()).toContain('second answer')
      expect(texts.join()).not.toContain('first answer')
      expect(manager.getBufferedEvents('s').length).toBeGreaterThan(texts.length)
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

  describe('watchdog: a silent session with a task open is waiting, not hung', () => {
    const HUNG_AFTER_MS = 121_000
    const sid = 'ccc-uuid-1234'

    async function silentAfter(messages: { type: string; [key: string]: unknown }[], maxDurationMs?: number) {
      const stream = (async function* () {
        for (const m of messages) yield { session_id: sid, ...m }
        await new Promise(() => {}) // the iterator stays open and says nothing
      })()
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(query).mockReturnValueOnce(Object.assign(stream, { streamInput: vi.fn() }) as never)
      await manager.startSession({ projectPath: '/p', prompt: 'x', permissionMode: 'default', ...(maxDurationMs ? { maxDurationMs } : {}) })
      await vi.advanceTimersByTimeAsync(0)
      const aborted = (manager as unknown as { activeSessions: Map<string, { abortController: AbortController }> })
        .activeSessions.get(sid)!.abortController.signal
      return aborted
    }

    beforeEach(async () => {
      vi.useFakeTimers()
      manager = new SessionManager()
      const scanner = await import('@/lib/claude-sessions/scanner')
      vi.mocked(scanner.getSessionLastActivityMs).mockImplementation(() => Date.now() - HUNG_AFTER_MS)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('ends a silent session with nothing open', async () => {
      const signal = await silentAfter([{ type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0 }])
      await vi.advanceTimersByTimeAsync(HUNG_AFTER_MS + 60_000)
      expect(signal.aborted).toBe(true)
    })

    it('keeps a silent session whose sub-agent is still running, past the ten minute stall', async () => {
      const signal = await silentAfter([{ type: 'system', subtype: 'task_started', task_id: 't1', task_type: 'local_agent' }])
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(signal.aborted).toBe(false)
    })

    it('ends it once the task reports back and the session goes quiet', async () => {
      const signal = await silentAfter([
        { type: 'system', subtype: 'task_started', task_id: 't1' },
        { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed' },
      ])
      await vi.advanceTimersByTimeAsync(HUNG_AFTER_MS + 60_000)
      expect(signal.aborted).toBe(true)
    })

    it('still ends a task that never reports at the duration cap, and reports it as the cap', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const signal = await silentAfter([{ type: 'system', subtype: 'task_started', task_id: 't1', task_type: 'local_agent' }], 5 * 60_000)
      await vi.advanceTimersByTimeAsync(4 * 60_000)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(signal.aborted).toBe(true)
      expect(warn.mock.calls.flat().join(' ')).toContain('self-healing (max-duration-exceeded)')
      warn.mockRestore()
    })

    it('gives a shell left running fifteen minutes of silence, then ends the session', async () => {
      const signal = await silentAfter([{ type: 'system', subtype: 'task_started', task_id: 's1', task_type: 'local_bash' }])
      await vi.advanceTimersByTimeAsync(14 * 60_000)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(signal.aborted).toBe(true)
    })

    it('reports the cut wait to listeners when the abort reaches the iterator', async () => {
      const ended: string[] = []
      manager.on('session_ended', (_sid: string, reason: string) => ended.push(reason))
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      let signal: AbortSignal | undefined
      const stream = (async function* () {
        yield { session_id: sid, type: 'system', subtype: 'task_started', task_id: 's1', task_type: 'local_bash' }
        await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))))
      })()
      vi.mocked(query).mockReturnValueOnce(Object.assign(stream, { streamInput: vi.fn() }) as never)
      await manager.startSession({ projectPath: '/p', prompt: 'x', permissionMode: 'default' })
      signal = (manager as unknown as { activeSessions: Map<string, { abortController: AbortController }> }).activeSessions.get(sid)!.abortController.signal
      await vi.advanceTimersByTimeAsync(17 * 60_000)
      expect(ended).toEqual(['shell-wait-expired'])
      expect(getSession(sid)!.errorMessage).toContain('shell-wait-expired')
    })

    it('ignores an error from an iterator already reported, and leaves a newer run alone', async () => {
      const ended: string[] = []
      manager.on('session_ended', (_sid: string, reason: string) => ended.push(reason))
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      let lateError: (e: Error) => void = () => {}
      const old = (async function* () {
        yield { session_id: sid, type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0 }
        await new Promise((_, reject) => { lateError = reject })
      })()
      vi.mocked(query).mockReturnValueOnce(Object.assign(old, { streamInput: vi.fn() }) as never)
      await manager.startSession({ projectPath: '/p', prompt: 'x', permissionMode: 'default' })
      await vi.advanceTimersByTimeAsync(HUNG_AFTER_MS + 60_000 + 31_000) // abort ignored, force-emitted
      expect(ended).toEqual(['hung-iterator-recovered'])

      await silentAfter([{ type: 'system', subtype: 'init' }])
      lateError(new Error('late'))
      await vi.advanceTimersByTimeAsync(0)
      expect(ended).toEqual(['hung-iterator-recovered'])
      expect(manager.isSessionActive(sid)).toBe(true)
    })

    it('still reports an error thrown by the normal end path', async () => {
      const ended: string[] = []
      manager.on('session_ended', (_sid: string, reason: string) => {
        ended.push(reason)
        if (reason === 'completed') throw new Error('a listener broke')
      })
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const done = (async function* () {
        yield { session_id: sid, type: 'system', subtype: 'init' }
      })()
      vi.mocked(query).mockReturnValueOnce(Object.assign(done, { streamInput: vi.fn() }) as never)
      await manager.startSession({ projectPath: '/p', prompt: 'x', permissionMode: 'default' })
      await vi.advanceTimersByTimeAsync(0)
      expect(ended).toEqual(['completed', 'a listener broke'])
    })

    it('does not carry an open task into the next run of the same session', async () => {
      const first = await silentAfter([{ type: 'system', subtype: 'task_started', task_id: 't1', task_type: 'local_agent' }], 60_000)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(first.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(31_000) // the force-emit path clears the session
      const second = await silentAfter([{ type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0 }])
      await vi.advanceTimersByTimeAsync(HUNG_AFTER_MS + 60_000)
      expect(second.aborted).toBe(true)
    })
  })

  describe('self-heal: processMessages rejection', () => {
    it('recovers when the SDK iterator throws synchronously so the singleton stays healthy for future sessions', async () => {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const mockQuery = query as unknown as ReturnType<typeof vi.fn>

      // Spike one bad session whose iterator throws immediately on first next().
      mockQuery.mockImplementationOnce(() => ({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error('simulated SDK failure')
            },
            async return() { return { value: undefined, done: true } },
            async throw(e: unknown) { throw e },
          }
        },
        streamInput: vi.fn(),
        close: vi.fn(),
      }))

      const endedEvents: Array<{ sid: string; reason: string }> = []
      manager.on('session_ended', (sid: string, reason: string) => {
        endedEvents.push({ sid, reason })
      })

      const badId = await manager.startSession({
        projectPath: '/test',
        prompt: 'this will blow up',
        permissionMode: 'bypassPermissions',
      })

      await new Promise((r) => setTimeout(r, 30))

      // Bad session must have fired session_ended with the error message, not
      // silently disappeared. This is the regression guard for the 41h
      // degradation on Apr 22-23 where processMessages rejections broke the
      // event pipeline for every subsequent session.
      expect(endedEvents.some((e) => e.sid === badId && e.reason.includes('simulated SDK failure'))).toBe(true)
      expect(manager.isSessionActive(badId)).toBe(false)

      // A normal session started right after must still emit session_ended.
      mockMessages = [
        { type: 'result', subtype: 'success', session_id: 'ccc-uuid-1234', num_turns: 1, total_cost_usd: 0.01, duration_ms: 100, duration_api_ms: 80, is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'good-run' },
      ]

      const goodId = await manager.startSession({
        projectPath: '/test',
        prompt: 'this should work',
        permissionMode: 'bypassPermissions',
      })

      await new Promise((r) => setTimeout(r, 30))

      expect(endedEvents.some((e) => e.sid === goodId && e.reason === 'completed')).toBe(true)
    })
  })
})
