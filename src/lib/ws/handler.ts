import type { WebSocket } from 'ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UserPayload, ClientMessage, ServerMessage } from '@/types/ws'
import { sessionManager } from '@/lib/sdk/session-manager'
import { getSessionJSONLPath } from '@/lib/claude-sessions/scanner'
import { readSessionTail, readSessionBefore } from '@/lib/claude-sessions/reader'

const clientSessions = new Map<WebSocket, Set<string>>()

export function handleConnection(ws: WebSocket, user: UserPayload) {
  clientSessions.set(ws, new Set())

  send(ws, { type: 'authenticated', user })

  ws.on('message', (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString())
      handleMessage(ws, user, message)
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format' })
    }
  })

  ws.on('close', () => {
    console.log(`WebSocket closed for ${user.email}`)
    clientSessions.delete(ws)
  })
}

async function handleMessage(ws: WebSocket, _user: UserPayload, message: ClientMessage) {
  switch (message.type) {
    case 'start': {
      try {
        console.log(`[WS] Starting session: ${message.projectPath} | mode: ${message.permissionMode}`)
        const sessionId = await sessionManager.startSession({
          projectPath: message.projectPath,
          prompt: message.prompt,
          permissionMode: message.permissionMode,
          model: message.model,
        })

        // Track this session for this WebSocket
        clientSessions.get(ws)?.add(sessionId)

        // Set up event relay
        const onSdkEvent = (sid: string, sdkMessage: unknown) => {
          if (sid === sessionId) {
            send(ws, { type: 'sdk_event', sessionId, message: sdkMessage as SDKMessage })
          }
        }

        const onSessionEnded = (sid: string, reason: string) => {
          if (sid === sessionId) {
            send(ws, { type: 'session_ended', sessionId, reason })
            sessionManager.removeListener('sdk_event', onSdkEvent)
            sessionManager.removeListener('session_ended', onSessionEnded)
            clientSessions.get(ws)?.delete(sessionId)
          }
        }

        sessionManager.on('sdk_event', onSdkEvent)
        sessionManager.on('session_ended', onSessionEnded)

        send(ws, { type: 'session_started', sessionId })
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Failed to start session' })
      }
      break
    }

    case 'send': {
      try {
        // Set up event relay if not already listening
        const sessionId = message.sessionId

        const onSdkEvent = (sid: string, sdkMessage: unknown) => {
          if (sid === sessionId) {
            send(ws, { type: 'sdk_event', sessionId, message: sdkMessage as SDKMessage })
          }
        }

        const onSessionEnded = (sid: string, reason: string) => {
          if (sid === sessionId) {
            send(ws, { type: 'session_ended', sessionId, reason })
            sessionManager.removeListener('sdk_event', onSdkEvent)
            sessionManager.removeListener('session_ended', onSessionEnded)
          }
        }

        sessionManager.on('sdk_event', onSdkEvent)
        sessionManager.on('session_ended', onSessionEnded)

        await sessionManager.resumeSession(message.sessionId, message.prompt)
        send(ws, { type: 'session_started', sessionId: message.sessionId })
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Failed to send message' })
      }
      break
    }

    case 'subscribe': {
      try {
        const sessionId = message.sessionId
        console.log(`[WS] Subscribe request for session: ${sessionId}`)

        if (sessionManager.isSessionActive(sessionId)) {
          // Active session: replay full in-memory buffer + attach live relay
          const buffered = sessionManager.getBufferedEvents(sessionId)
          console.log(`[WS] Replaying ${buffered.length} buffered events for active session ${sessionId}`)
          for (const event of buffered) {
            send(ws, { type: 'sdk_event', sessionId, message: event.message as SDKMessage })
          }

          send(ws, { type: 'session_started', sessionId })

          const onSdkEvent = (sid: string, sdkMessage: unknown) => {
            if (sid === sessionId) {
              send(ws, { type: 'sdk_event', sessionId, message: sdkMessage as SDKMessage })
            }
          }

          const onSessionEnded = (sid: string, reason: string) => {
            if (sid === sessionId) {
              send(ws, { type: 'session_ended', sessionId, reason })
              sessionManager.removeListener('sdk_event', onSdkEvent)
              sessionManager.removeListener('session_ended', onSessionEnded)
            }
          }

          sessionManager.on('sdk_event', onSdkEvent)
          sessionManager.on('session_ended', onSessionEnded)
        } else {
          // Inactive session: read only the tail from disk for fast loading
          const jsonlPath = getSessionJSONLPath(sessionId)
          if (jsonlPath) {
            const { events, cursor, hasMore } = readSessionTail(jsonlPath)
            console.log(`[WS] Sending ${events.length} tail events for session ${sessionId} (cursor=${cursor}, hasMore=${hasMore})`)
            for (const event of events) {
              send(ws, { type: 'sdk_event', sessionId, message: event.message as SDKMessage })
            }
            send(ws, { type: 'history_batch', sessionId, messages: [], cursor, hasMore })
          }
          send(ws, { type: 'session_ended', sessionId, reason: 'completed' })
        }
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Failed to subscribe' })
      }
      break
    }

    case 'load_previous': {
      try {
        const sessionId = message.sessionId
        const cursor = message.cursor
        const jsonlPath = getSessionJSONLPath(sessionId)
        if (!jsonlPath) {
          send(ws, { type: 'history_batch', sessionId, messages: [], cursor: 0, hasMore: false })
          break
        }
        const result = readSessionBefore(jsonlPath, cursor)
        console.log(`[WS] Sending ${result.events.length} previous events for session ${sessionId} (cursor=${result.cursor}, hasMore=${result.hasMore})`)
        const sdkMessages = result.events.map((e) => e.message as SDKMessage)
        send(ws, { type: 'history_batch', sessionId, messages: sdkMessages, cursor: result.cursor, hasMore: result.hasMore })
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Failed to load previous messages' })
      }
      break
    }

    case 'stop': {
      sessionManager.stopSession(message.sessionId)
      break
    }
  }
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}
