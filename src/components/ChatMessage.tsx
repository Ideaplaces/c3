'use client'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCallBlock } from './tools/ToolCallBlock'
import { extractUserMessageText } from '@/lib/messages/user-content'

interface ChatMessageProps {
  message: SDKMessage
  toolResults?: Map<string, { content: string; isError: boolean }>
}

export function ChatMessage({ message, toolResults }: ChatMessageProps) {
  switch (message.type) {
    case 'system': {
      if ('subtype' in message) {
        if (message.subtype === 'init') {
          return (
            <div className="text-foreground-muted text-xs py-1.5 px-3 bg-surface/50 rounded border border-border/50 inline-block">
              {message.model} &middot; {message.permissionMode} &middot; {message.tools.length} tools
            </div>
          )
        }
        if (message.subtype === 'status') {
          if (message.status === 'compacting') {
            return (
              <div className="text-foreground-muted text-xs py-1 italic">
                Compacting context...
              </div>
            )
          }
          return null
        }
      }
      return null
    }

    case 'user': {
      // Skip replayed messages (they're context, not new conversation)
      if ('isReplay' in message && message.isReplay) return null

      const text = extractUserMessageText(message.message.content)
      if (text === null) return null

      return (
        <div className="flex gap-2 sm:gap-3 py-3">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">
            U
          </div>
          <div className="flex-1 text-sm whitespace-pre-wrap pt-0.5 min-w-0 break-words">
            {text}
          </div>
        </div>
      )
    }

    case 'assistant': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = message.message.content || []

      // Separate text/thinking blocks from tool_use blocks
      const textBlocks = blocks.filter((b) => b.type === 'text' && b.text?.trim())
      const thinkingBlocks = blocks.filter((b) => b.type === 'thinking' && b.thinking)
      const toolBlocks = blocks.filter((b) => b.type === 'tool_use')

      const hasText = textBlocks.length > 0
      const hasThinking = thinkingBlocks.length > 0
      const hasTools = toolBlocks.length > 0

      // If this message is ONLY tool calls (no text), render compactly without the avatar
      if (!hasText && !hasThinking && hasTools) {
        return (
          <div className="pl-0 sm:pl-10 space-y-1">
            {toolBlocks.map((block, i) => {
              const result = toolResults?.get(block.id)
              return (
                <ToolCallBlock
                  key={i}
                  toolName={block.name}
                  toolId={block.id}
                  input={block.input as Record<string, unknown>}
                  output={result?.content}
                  isError={result?.isError}
                />
              )
            })}
          </div>
        )
      }

      return (
        <div className="flex gap-2 sm:gap-3 py-2">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-secondary/20 flex items-center justify-center text-secondary text-xs font-bold shrink-0">
            C
          </div>
          <div className="flex-1 space-y-2 min-w-0 break-words">
            {blocks.map((block, i) => {
              if (block.type === 'text' && block.text?.trim()) {
                return <MarkdownRenderer key={i} content={block.text} />
              }
              if (block.type === 'thinking') {
                return <ThinkingBlock key={i} content={block.thinking} />
              }
              if (block.type === 'tool_use') {
                const result = toolResults?.get(block.id)
                return (
                  <ToolCallBlock
                    key={i}
                    toolName={block.name}
                    toolId={block.id}
                    input={block.input as Record<string, unknown>}
                    output={result?.content}
                    isError={result?.isError}
                  />
                )
              }
              return null
            })}
          </div>
        </div>
      )
    }

    case 'result': {
      const isError = message.subtype !== 'success'
      return (
        <div className={`text-xs py-1.5 px-3 rounded border inline-block ${
          isError ? 'bg-error/10 border-error/30 text-error' : 'bg-success/10 border-success/30 text-success'
        }`}>
          {isError ? 'Error' : 'Done'}
          {' '}&middot; {message.num_turns} turns
          {' '}&middot; ${message.total_cost_usd.toFixed(4)}
        </div>
      )
    }

    case 'stream_event':
      return null

    default:
      return null
  }
}
