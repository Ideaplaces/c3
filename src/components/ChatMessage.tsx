'use client'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCallBlock } from './tools/ToolCallBlock'

interface ChatMessageProps {
  message: SDKMessage
  // Map of tool_use_id -> tool result content for pairing tool calls with their results
  toolResults?: Map<string, { content: string; isError: boolean }>
}

export function ChatMessage({ message, toolResults }: ChatMessageProps) {
  switch (message.type) {
    case 'system': {
      if ('subtype' in message) {
        if (message.subtype === 'init') {
          return (
            <div className="text-foreground-muted text-sm py-2 px-3 bg-surface rounded-md border border-border">
              Session started &middot; Model: <span className="font-mono text-secondary">{message.model}</span>
              {' '}&middot; Mode: <span className="font-mono">{message.permissionMode}</span>
              {' '}&middot; Tools: {message.tools.length}
            </div>
          )
        }
        if (message.subtype === 'status') {
          if (message.status === 'compacting') {
            return (
              <div className="text-foreground-muted text-sm py-1 italic">
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
      const content = typeof message.message.content === 'string'
        ? message.message.content
        : JSON.stringify(message.message.content)

      if ('isReplay' in message && message.isReplay) {
        return (
          <div className="text-foreground-muted text-sm py-1 italic">
            (replayed) {content}
          </div>
        )
      }

      return (
        <div className="flex gap-3 py-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold shrink-0">
            U
          </div>
          <div className="flex-1 font-mono text-sm whitespace-pre-wrap pt-1">
            {content}
          </div>
        </div>
      )
    }

    case 'assistant': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = message.message.content || []

      return (
        <div className="flex gap-3 py-3">
          <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center text-secondary text-sm font-bold shrink-0">
            C
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            {blocks.map((block, i) => {
              if (block.type === 'text') {
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
              if (block.type === 'tool_result') {
                // Tool results are shown inline with their corresponding tool_use
                // via toolResults prop. Skip standalone rendering.
                return null
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
        <div className={`text-sm py-2 px-3 rounded-md border ${
          isError ? 'bg-error/10 border-error/30 text-error' : 'bg-success/10 border-success/30 text-success'
        }`}>
          {isError ? 'Error' : 'Completed'}
          {' '}&middot; Turns: {message.num_turns}
          {' '}&middot; Cost: ${message.total_cost_usd.toFixed(4)}
          {message.subtype === 'success' && message.result && (
            <div className="mt-1 text-foreground text-xs font-mono whitespace-pre-wrap">
              {message.result.slice(0, 500)}
            </div>
          )}
        </div>
      )
    }

    case 'stream_event': {
      // Stream events are handled by the stream accumulator
      return null
    }

    default:
      return null
  }
}
