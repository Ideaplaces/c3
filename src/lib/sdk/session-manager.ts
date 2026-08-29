import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { hostname } from 'os'

import { createSession, updateSession, getSession } from '@/lib/store/sessions'
import { getSessionJSONLPath, getSessionLastActivityMs } from '@/lib/claude-sessions/scanner'
import { readSessionJSONL } from '@/lib/claude-sessions/reader'
import { basename } from 'path'
import { DEFAULT_MODEL } from '@/lib/models'
import { recordSessionUsage, startUsageTracking, trackAssistantUsage } from '@/lib/usage'

interface ActiveSession {
  id: string
  query: Query
  abortController: AbortController
  projectPath: string
  label: string
  model: string
}

interface StartSessionParams {
  projectPath: string
  prompt: string
  permissionMode: string
  model?: string
  sessionId?: string
  /** Who started it, for the usage ledger: `cron:<trigger>`, `slack:<trigger>`, `discord:<trigger>`, `web`. */
  label?: string
}

// Classic stall: the SDK generator stops emitting events for this long → abort
// and force-emit session_ended so Slack/Discord replies still fire. Configurable
// via env for jobs that legitimately think for a long time.
const STALL_TIMEOUT_MS = parseInt(process.env.C3_SESSION_STALL_TIMEOUT_MS || '600000', 10)
const STALL_CHECK_INTERVAL_MS = 60_000
// JSONL self-heal: when the SDK's on-disk session file has stopped growing
// AND the iterator has gone quiet, the agent is done but the iterator hung.
// The JSONL is our independent source of truth. Recover by force-emitting
// session_ended as 'completed' so listeners pick up the agent's final output.
const JSONL_IDLE_RECOVERY_MS = parseInt(process.env.C3_JSONL_IDLE_RECOVERY_MS || '90000', 10)
// Hard cap: no session can run longer than this. Ultimate safety net.
const MAX_SESSION_DURATION_MS = parseInt(process.env.C3_MAX_SESSION_DURATION_MS || '1800000', 10)

export class SessionManager extends EventEmitter {
  private activeSessions = new Map<string, ActiveSession>()
  private eventBuffers = new Map<string, { sessionId: string; message: unknown }[]>()
  private lastEventTime = new Map<string, number>()
  private sessionStartTime = new Map<string, number>()
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
      const eventAgeMs = now - lastEvent

      const sessionStart = this.sessionStartTime.get(sid) ?? now
      const sessionAgeMs = now - sessionStart

      // Independent disk-based signal: has the SDK stopped writing the session
      // file? If yes, the agent is done regardless of what the iterator is doing.
      //
      // This counts subagent transcripts too. A session that delegates with the
      // Task tool writes nothing to its own JSONL while the subagent runs, so
      // looking at the parent file alone reports a working session as hung and
      // kills it mid-investigation.
      let jsonlIdleMs: number | null = null
      const lastActivityMs = getSessionLastActivityMs(sid)
      if (lastActivityMs !== null) {
        jsonlIdleMs = now - lastActivityMs
      }

      const isClassicStall = eventAgeMs > STALL_TIMEOUT_MS
      const isHungIterator =
        jsonlIdleMs !== null &&
        jsonlIdleMs > JSONL_IDLE_RECOVERY_MS &&
        eventAgeMs > JSONL_IDLE_RECOVERY_MS
      const isOverMaxDuration = sessionAgeMs > MAX_SESSION_DURATION_MS

      if (!isClassicStall && !isHungIterator && !isOverMaxDuration) continue

      const reason = isHungIterator
        ? 'hung-iterator-recovered'
        : isOverMaxDuration
          ? 'max-duration-exceeded'
          : 'stalled'

      console.warn(
        `[SessionManager] Session ${sid} self-healing (${reason}): ` +
          `eventAge=${Math.round(eventAgeMs / 1000)}s, ` +
          `jsonlIdle=${jsonlIdleMs !== null ? Math.round(jsonlIdleMs / 1000) + 's' : 'n/a'}, ` +
          `sessionAge=${Math.round(sessionAgeMs / 1000)}s`,
      )
      this.stalledSessions.add(sid)
      try {
        active.abortController.abort()
      } catch (err) {
        console.error(`[SessionManager] Abort failed for ${sid}:`, err)
      }
      // In case abort does not propagate into the generator, force-emit
      // session_ended after a short grace period so Slack/Discord replies fire.
      // For the hung-iterator case, the JSONL on disk already contains the full
      // agent output, so listeners extracting a summary still get it.
      setTimeout(() => {
        if (this.activeSessions.has(sid)) {
          console.warn(
            `[SessionManager] Session ${sid} did not exit after abort. Force-emitting session_ended (${reason}).`,
          )
          this.activeSessions.delete(sid)
          this.lastEventTime.delete(sid)
          this.sessionStartTime.delete(sid)
          const isRecovery = reason === 'hung-iterator-recovered'
          updateSession(sid, {
            status: isRecovery ? 'completed' : 'error',
            ...(isRecovery ? {} : { errorMessage: `${reason}: no SDK events within timeout` }),
          })
          this.emit('session_ended', sid, reason)
        }
      }, 30_000)
    }
  }

  // Cleanup that every path out of a session must call, so the session-start
  // map never leaks even if processMessages rejects synchronously.
  private cleanupSessionState(sessionId: string) {
    this.activeSessions.delete(sessionId)
    this.lastEventTime.delete(sessionId)
    this.sessionStartTime.delete(sessionId)
    this.stalledSessions.delete(sessionId)
  }

  async startSession(params: StartSessionParams): Promise<string> {
    const { projectPath, prompt, permissionMode, model } = params
    const label = params.label ?? 'unlabelled'
    const sessionId = params.sessionId ?? randomUUID()
    // Always pin the model explicitly. Without this the SDK falls back to the
    // CLI's own default, which drifts from what we record and show for the session.
    const resolvedModel = model || DEFAULT_MODEL
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
      model: resolvedModel,
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
      model: resolvedModel,
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
      label,
      model: resolvedModel,
    })
    this.sessionStartTime.set(sessionId, Date.now())
    startUsageTracking(sessionId, label)

    // Fire-and-forget, but catch rejections so a single bad session cannot
    // silently break session_ended emission for every subsequent session.
    this.processMessages(sessionId, q).catch((err) => this.onProcessMessagesRejection(sessionId, err))

    return sessionId
  }

  private onProcessMessagesRejection(sessionId: string, err: unknown) {
    console.error(`[SessionManager] processMessages rejected for ${sessionId}:`, err)
    if (!this.activeSessions.has(sessionId)) return
    this.cleanupSessionState(sessionId)
    const errMessage = err instanceof Error ? err.message : String(err)
    updateSession(sessionId, { status: 'error', errorMessage: errMessage })
    this.emit('session_ended', sessionId, errMessage)
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
      label: 'resume',
      model: sessionMeta?.model ?? DEFAULT_MODEL,
    })
    this.sessionStartTime.set(sessionId, Date.now())

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

    this.processMessages(sessionId, q).catch((err) => this.onProcessMessagesRejection(sessionId, err))
  }

  stopSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.query.close()
      this.cleanupSessionState(sessionId)
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
        if (message.type === 'assistant') {
          // Live usage: alert while the run is still stoppable, not after.
          void trackAssistantUsage(sessionId, (message as { message?: { usage?: Parameters<typeof trackAssistantUsage>[1] } }).message?.usage)
        }
        this.handleMessageMetadata(sessionId, message)
      }

      // Generator completed normally
      this.cleanupSessionState(sessionId)
      const currentSession = getSession(sessionId)
      if (!currentSession || !['completed', 'error'].includes(currentSession.status)) {
        updateSession(sessionId, { status: 'idle' })
      }
      this.emit('session_ended', sessionId, 'completed')
    } catch (error) {
      const wasStalled = this.stalledSessions.has(sessionId)
      this.cleanupSessionState(sessionId)
      const errorMessage = wasStalled
        ? 'stalled: SDK generator aborted after no events within timeout'
        : error instanceof Error ? error.message : 'Unknown error'
      updateSession(sessionId, { status: 'error', errorMessage })
      this.emit('session_ended', sessionId, wasStalled ? 'stalled' : errorMessage)
    }
  }

  private handleMessageMetadata(sessionId: string, message: SDKMessage) {
    if (message.type === 'result') {
      const active = this.activeSessions.get(sessionId)
      // Every finished run gets a ledger line; only an outlier reaches Discord.
      void recordSessionUsage(message, {
        sessionId,
        label: active?.label ?? 'unlabelled',
        projectPath: active?.projectPath ?? '',
        model: active?.model ?? '',
      })
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
