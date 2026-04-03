import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { getToolSummary } from '@/lib/messages/parser'

export interface DisplayGroup {
  type: 'user' | 'assistant-text' | 'activity' | 'system' | 'result'
  messages: SDKMessage[]
  toolSummaries?: string[]
}

export function groupMessages(messages: SDKMessage[]): DisplayGroup[] {
  const groups: DisplayGroup[] = []
  let currentActivity: SDKMessage[] = []
  let currentToolSummaries: string[] = []

  const flushActivity = () => {
    if (currentActivity.length > 0) {
      groups.push({
        type: 'activity',
        messages: [...currentActivity],
        toolSummaries: [...currentToolSummaries],
      })
      currentActivity = []
      currentToolSummaries = []
    }
  }

  for (const msg of messages) {
    if (msg.type === 'system') {
      flushActivity()
      groups.push({ type: 'system', messages: [msg] })
      continue
    }

    if (msg.type === 'result') {
      flushActivity()
      groups.push({ type: 'result', messages: [msg] })
      continue
    }

    if (msg.type === 'user') {
      const content = msg.message.content
      if (Array.isArray(content)) {
        const hasToolResult = content.some(
          (block: unknown) => typeof block === 'object' && block !== null && 'type' in block && (block as { type: string }).type === 'tool_result'
        )
        if (hasToolResult) {
          currentActivity.push(msg)
          continue
        }
      }
      flushActivity()
      groups.push({ type: 'user', messages: [msg] })
      continue
    }

    if (msg.type === 'assistant') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = msg.message.content || []
      const hasText = blocks.some((b) => b.type === 'text' && b.text?.trim())
      const toolUses = blocks.filter((b) => b.type === 'tool_use')

      if (hasText) {
        flushActivity()
        groups.push({ type: 'assistant-text', messages: [msg] })
      } else if (toolUses.length > 0) {
        currentActivity.push(msg)
        for (const tool of toolUses) {
          currentToolSummaries.push(
            getToolSummary(tool.name, tool.input as Record<string, unknown>)
          )
        }
      } else {
        currentActivity.push(msg)
      }
      continue
    }

    continue
  }

  flushActivity()
  return groups
}

export function extractToolResults(sdkMessages: SDKMessage[]): Map<string, { content: string; isError: boolean }> {
  const map = new Map<string, { content: string; isError: boolean }>()
  for (const msg of sdkMessages) {
    if (msg.type !== 'user') continue
    const content = msg.message.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result') {
        const toolBlock = block as { tool_use_id: string; content?: string | unknown[]; is_error?: boolean }
        const text = typeof toolBlock.content === 'string'
          ? toolBlock.content
          : Array.isArray(toolBlock.content)
            ? toolBlock.content
                .map((c: unknown) => {
                  if (typeof c === 'object' && c !== null && 'text' in c) return (c as { text: string }).text
                  return JSON.stringify(c)
                })
                .join('\n')
            : ''
        map.set(toolBlock.tool_use_id, { content: text, isError: !!toolBlock.is_error })
      }
    }
  }
  return map
}

export interface SessionStatus {
  isRunning: boolean
}

/**
 * Determine if a session is currently running based on the WebSocket message history.
 * A session is running if the most recent session_started comes after the most recent session_ended.
 */
export function getSessionStatus(messages: { type: string }[]): SessionStatus {
  let lastStartIdx = -1
  let lastEndIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (lastStartIdx === -1 && m.type === 'session_started') lastStartIdx = i
    if (lastEndIdx === -1 && m.type === 'session_ended') lastEndIdx = i
    if (lastStartIdx !== -1 && lastEndIdx !== -1) break
  }
  return { isRunning: lastStartIdx > lastEndIdx }
}
