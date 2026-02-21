import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

// Client → Server messages
export type ClientMessage =
  | { type: 'start'; projectPath: string; prompt: string; permissionMode: string; model?: string }
  | { type: 'send'; sessionId: string; prompt: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'subscribe'; sessionId: string }

// Server → Client messages
export type ServerMessage =
  | { type: 'authenticated'; user: UserPayload }
  | { type: 'sdk_event'; sessionId: string; message: SDKMessage }
  | { type: 'error'; message: string }
  | { type: 'session_started'; sessionId: string }
  | { type: 'session_ended'; sessionId: string; reason: string }

export interface UserPayload {
  email: string
  name: string
  avatarUrl: string | null
}
