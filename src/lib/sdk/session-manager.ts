import { query, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { createSession, updateSession } from '@/lib/store/sessions'
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

class SessionManager extends EventEmitter {
  private activeSessions = new Map<string, ActiveSession>()

  async startSession(params: StartSessionParams): Promise<string> {
    const { projectPath, prompt, permissionMode, model } = params
    const sessionId = randomUUID()
    const abortController = new AbortController()

    const options: Options = {
      cwd: projectPath,
      abortController,
      includePartialMessages: true,
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      ...(model && { model }),
    }

    if (permissionMode === 'bypassPermissions') {
      options.permissionMode = 'bypassPermissions'
      options.allowDangerouslySkipPermissions = true
    } else if (permissionMode === 'acceptEdits') {
      options.permissionMode = 'acceptEdits'
    } else {
      options.permissionMode = 'default'
    }

    // Create session metadata
    createSession({
      id: sessionId,
      projectPath,
      projectName: basename(projectPath),
      machineName: hostname(),
      status: 'running',
      permissionMode,
      model: model || 'claude-sonnet-4-6',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
      totalCostUsd: 0,
      lastPrompt: prompt,
    })

    const q = query({ prompt, options })

    const activeSession: ActiveSession = {
      id: sessionId,
      query: q,
      abortController,
      projectPath,
    }

    this.activeSessions.set(sessionId, activeSession)

    // Process messages in background
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

    // Session is not active, start a new query with resume
    const abortController = new AbortController()

    const options: Options = {
      resume: sessionId,
      abortController,
      includePartialMessages: true,
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
    }

    const q = query({ prompt, options })

    this.activeSessions.set(sessionId, {
      id: sessionId,
      query: q,
      abortController,
      projectPath: '',
    })

    updateSession(sessionId, { status: 'running', lastPrompt: prompt })

    this.processMessages(sessionId, q)
  }

  stopSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.query.close()
      this.activeSessions.delete(sessionId)
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

  private async processMessages(sessionId: string, q: Query) {
    try {
      for await (const message of q) {
        this.emit('sdk_event', sessionId, message)
        this.handleMessageMetadata(sessionId, message)
      }

      // Generator completed normally
      this.activeSessions.delete(sessionId)
      updateSession(sessionId, { status: 'idle' })
      this.emit('session_ended', sessionId, 'completed')
    } catch (error) {
      this.activeSessions.delete(sessionId)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      updateSession(sessionId, { status: 'error', errorMessage })
      this.emit('session_ended', sessionId, errorMessage)
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
