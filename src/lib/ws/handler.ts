import type { WebSocket } from 'ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UserPayload, ClientMessage, ServerMessage } from '@/types/ws'
import { sessionManager } from '@/lib/sdk/session-manager'

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
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Failed to send message' })
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
