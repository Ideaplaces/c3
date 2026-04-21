import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { createSession, updateSession, getSession } from '@/lib/store/sessions'
import { getSessionJSONLPath } from '@/lib/claude-sessions/scanner'
import { readSessionJSONL } from '@/lib/claude-sessions/reader'
import { basename } from 'path'

interface ActiveSession {
  id: string
  query: Query
  abortController: AbortController
  projectPath: string
}

interface StartSessionParams {
  projectPath: string
  prompt: string
  permissionMode: string
  model?: string
}

// Sessions whose SDK generator stops emitting events for longer than this are
// presumed hung and force-aborted so listeners (Slack/Discord webhooks) still
// receive a session_ended signal. Configurable via env for long-running jobs.
const STALL_TIMEOUT_MS = parseInt(process.env.C3_SESSION_STALL_TIMEOUT_MS || '600000', 10)
const STALL_CHECK_INTERVAL_MS = 60_000

export class SessionManager extends EventEmitter {
  private activeSessions = new Map<string, ActiveSession>()
  private eventBuffers = new Map<string, { sessionId: string; message: unknown }[]>()
  private lastEventTime = new Map<string, number>()
  private stalledSessions = new Set<string>()
  private watchdogInterval: NodeJS.Timeout

  constructor() {
    super()
    this.watchdogInterval = setInterval(() => this.checkStalledSessions(), STALL_CHECK_INTERVAL_MS)
    // Don't keep the Node process alive just for this timer.
    this.watchdogInterval.unref?.()
  }

  private checkStalledSessions() {
    const now = Date.now()
    for (const [sid, active] of this.activeSessions) {
      if (this.stalledSessions.has(sid)) continue
      const lastEvent = this.lastEventTime.get(sid) ?? now
      const ageMs = now - lastEvent
      if (ageMs > STALL_TIMEOUT_MS) {
        console.warn(
          `[SessionManager] Session ${sid} stalled: no SDK events for ${Math.round(ageMs / 1000)}s (timeout ${STALL_TIMEOUT_MS / 1000}s). Aborting.`
        )
        this.stalledSessions.add(sid)
        try {
          active.abortController.abort()
        } catch (err) {
          console.error(`[SessionManager] Abort failed for ${sid}:`, err)
        }
        // In case abort does not propagate into the generator (observed with
        // hung SDK streams), emit session_ended directly after a short grace
        // period so the Slack/Discord reply still goes out.
        setTimeout(() => {
          if (this.activeSessions.has(sid)) {
            console.warn(`[SessionManager] Session ${sid} did not exit after abort. Force-emitting session_ended.`)
            this.activeSessions.delete(sid)
            updateSession(sid, { status: 'error', errorMessage: 'stalled: no SDK events within timeout' })
            this.emit('session_ended', sid, 'stalled')
          }
        }, 30_000)
      }
    }
  }

  async startSession(params: StartSessionParams): Promise<string> {
    const { projectPath, prompt, permissionMode, model } = params
    const sessionId = randomUUID()
    const abortController = new AbortController()

    // Strip CLAUDECODE env var to allow nested SDK sessions
    // Strip ANTHROPIC_API_KEY to force Claude Max subscription (fixed cost)
    // Strip SLACK_BOT_TOKEN to prevent agents from posting to Slack directly
    // Strip DISCORD_BOT_TOKEN to prevent agents from posting to Discord directly
    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    delete cleanEnv.ANTHROPIC_API_KEY
    delete cleanEnv.SLACK_BOT_TOKEN
    delete cleanEnv.DISCORD_BOT_TOKEN

    const options: Options = {
      sessionId,
      cwd: projectPath,
      abortController,
      includePartialMessages: true,
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      env: cleanEnv,
      ...(model && { model }),
    }

    // Default to bypass. Can be overridden by the client.
    if (permissionMode === 'acceptEdits') {
      options.permissionMode = 'acceptEdits'
    } else if (permissionMode === 'default') {
      options.permissionMode = 'default'
    } else {
      options.permissionMode = 'bypassPermissions'
      options.allowDangerouslySkipPermissions = true
    }

    // Track session in CCC overlay (for active session metadata)
    createSession({
      id: sessionId,
      projectPath,
      projectName: basename(projectPath),
      machineName: hostname(),
      status: 'running',
      permissionMode,
      model: model || 'claude-opus-4-6',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
      totalCostUsd: 0,
      firstPrompt: prompt,
      lastPrompt: prompt,
    })

    const q = query({ prompt, options })

    this.activeSessions.set(sessionId, {
      id: sessionId,
      query: q,
      abortController,
      projectPath,
    })

    this.processMessages(sessionId, q)

    return sessionId
  }

  async resumeSession(sessionId: string, prompt: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)

    if (active) {
      // Session is still active, send message via streamInput
      await active.query.streamInput(
        (async function* () {
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content: prompt },
            parent_tool_use_id: null,
            session_id: sessionId,
          }
        })()
      )
      return
    }

    // Session is not active. Resume using the session ID directly.
    // CCC passes sessionId to the SDK on start, so they share the same ID.
    // CLI sessions also use the SDK session ID as the session identifier.
    const sessionMeta = getSession(sessionId)
    const projectPath = sessionMeta?.projectPath || ''

    const abortController = new AbortController()

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    delete cleanEnv.ANTHROPIC_API_KEY
    delete cleanEnv.SLACK_BOT_TOKEN
    delete cleanEnv.DISCORD_BOT_TOKEN

    const options: Options = {
      resume: sessionId,
      abortController,
      includePartialMessages: true,
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      env: cleanEnv,
      ...(projectPath && { cwd: projectPath }),
      // Always bypass permissions. Single user, trusted environment.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    }

    const q = query({ prompt, options })

    this.activeSessions.set(sessionId, {
      id: sessionId,
      query: q,
      abortController,
      projectPath,
    })

    // Create/update CCC overlay entry
    if (sessionMeta) {
      updateSession(sessionId, { status: 'running', lastPrompt: prompt })
    } else {
      createSession({
        id: sessionId,
        projectPath,
        projectName: basename(projectPath || 'unknown'),
        machineName: hostname(),
        status: 'running',
        permissionMode: '',
        model: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turnCount: 0,
        totalCostUsd: 0,
        firstPrompt: prompt,
        lastPrompt: prompt,
      })
    }

    this.processMessages(sessionId, q)
  }

  stopSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.query.close()
      this.activeSessions.delete(sessionId)
      this.lastEventTime.delete(sessionId)
      this.stalledSessions.delete(sessionId)
      updateSession(sessionId, { status: 'idle' })
      this.emit('session_ended', sessionId, 'stopped')
    }
  }

  getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  getBufferedEvents(sessionId: string): { sessionId: string; message: unknown }[] {
    // Check in-memory buffer first (active/recent sessions)
    const memoryBuffer = this.eventBuffers.get(sessionId)
    if (memoryBuffer && memoryBuffer.length > 0) {
      return memoryBuffer
    }

    // Fall back to Claude Code's native JSONL storage
    const jsonlPath = getSessionJSONLPath(sessionId)
    if (jsonlPath) {
      const events = readSessionJSONL(jsonlPath)
      if (events.length > 0) {
        // Cache in memory for fast subsequent reads
        this.eventBuffers.set(sessionId, events)
        return events
      }
    }

    return []
  }

  private async processMessages(sessionId: string, q: Query) {
    // Initialize event buffer only if it doesn't exist (preserves history across resumes)
    if (!this.eventBuffers.has(sessionId)) {
      this.eventBuffers.set(sessionId, [])
    }

    this.lastEventTime.set(sessionId, Date.now())

    try {
      for await (const message of q) {
        this.lastEventTime.set(sessionId, Date.now())
        // Buffer the event in memory for late subscribers
        const event = { sessionId, message }
        const buffer = this.eventBuffers.get(sessionId)
        if (buffer) {
          buffer.push(event)
        }
        // SDK automatically persists to ~/.claude/projects/ JSONL
        this.emit('sdk_event', sessionId, message)
        this.handleMessageMetadata(sessionId, message)
      }

      // Generator completed normally
      this.activeSessions.delete(sessionId)
      this.lastEventTime.delete(sessionId)
      this.stalledSessions.delete(sessionId)
      const currentSession = getSession(sessionId)
      if (!currentSession || !['completed', 'error'].includes(currentSession.status)) {
        updateSession(sessionId, { status: 'idle' })
      }
      this.emit('session_ended', sessionId, 'completed')
    } catch (error) {
      this.activeSessions.delete(sessionId)
      this.lastEventTime.delete(sessionId)
      const wasStalled = this.stalledSessions.delete(sessionId)
      const errorMessage = wasStalled
        ? 'stalled: SDK generator aborted after no events within timeout'
        : error instanceof Error ? error.message : 'Unknown error'
      updateSession(sessionId, { status: 'error', errorMessage })
      this.emit('session_ended', sessionId, wasStalled ? 'stalled' : errorMessage)
    }
  }

  private handleMessageMetadata(sessionId: string, message: SDKMessage) {
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        updateSession(sessionId, {
          turnCount: message.num_turns,
          totalCostUsd: message.total_cost_usd,
          status: 'completed',
        })
      } else {
        updateSession(sessionId, {
          turnCount: message.num_turns,
          totalCostUsd: message.total_cost_usd,
          status: 'error',
          errorMessage: message.errors?.[0],
        })
      }
    }
  }
}

// Singleton
export const sessionManager = new SessionManager()
