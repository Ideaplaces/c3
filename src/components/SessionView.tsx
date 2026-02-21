'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { ServerMessage } from '@/types/ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ChatMessage } from './ChatMessage'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useStreamAccumulator, type AccumulatedBlock } from '@/hooks/useStreamAccumulator'

interface SessionViewProps {
  ws: {
    messages: ServerMessage[]
    connected: boolean
    sessionId: string | null
    sendPrompt: (sessionId: string, prompt: string) => void
    stopSession: (sessionId: string) => void
  }
  sessionId?: string
  projectName: string
}

function StreamingBlock({ block }: { block: AccumulatedBlock }) {
  if (block.type === 'thinking') {
    return (
      <details className="text-foreground-muted text-sm" open={!block.complete}>
        <summary className="cursor-pointer hover:text-foreground">
          {block.complete ? 'Thought' : 'Thinking...'}
        </summary>
        <div className="mt-1 pl-4 border-l-2 border-border whitespace-pre-wrap text-xs font-mono">
          {block.content}
        </div>
      </details>
    )
  }

  if (block.type === 'tool_use') {
    return (
      <div className="card p-3 text-sm">
        <div className="font-medium text-secondary mb-1">
          {block.toolName}
        </div>
        {block.toolInput && (
          <pre className="text-xs text-foreground-muted overflow-x-auto">
            {block.toolInput}
          </pre>
        )}
      </div>
    )
  }

  // text block
  return (
    <div className="text-sm whitespace-pre-wrap break-words">
      {block.content}
      {!block.complete && <span className="animate-pulse">|</span>}
    </div>
  )
}

export function SessionView({ ws, sessionId, projectName }: SessionViewProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { state: streamState, processEvent, reset: resetStream } = useStreamAccumulator()

  const activeSessionId = ws.sessionId || sessionId || null
  const isRunning = !ws.messages.some(
    (m) => m.type === 'session_ended'
  ) && ws.messages.some(
    (m) => m.type === 'session_started' || m.type === 'sdk_event'
  )

  // Extract complete SDK messages (non-streaming)
  const sdkMessages: SDKMessage[] = ws.messages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type !== 'stream_event')

  // Build tool results map: tool_use_id -> { content, isError }
  const toolResults = useMemo(() => {
    const map = new Map<string, { content: string; isError: boolean }>()
    // Look through user messages for tool_result content blocks
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
  }, [sdkMessages])

  // Process streaming events
  const streamEvents = ws.messages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type === 'stream_event')

  useEffect(() => {
    const lastEvent = streamEvents[streamEvents.length - 1]
    if (lastEvent && lastEvent.type === 'stream_event') {
      processEvent(lastEvent.event)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamEvents.length])

  // Reset stream accumulator when a complete assistant message arrives
  useEffect(() => {
    const lastMsg = sdkMessages[sdkMessages.length - 1]
    if (lastMsg?.type === 'assistant') {
      resetStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMessages.length])

  // Detect project name from init message
  const initMessage = sdkMessages.find((m) => m.type === 'system' && 'subtype' in m && m.subtype === 'init')
  const displayProject = projectName || (initMessage && 'cwd' in initMessage ? String(initMessage.cwd).split('/').pop() : '')

  // Auto-scroll
  const { containerRef, showScrollButton, scrollToBottom } = useAutoScroll(
    streamState.blocks.length + sdkMessages.length
  )

  const handleSend = () => {
    if (!input.trim() || !activeSessionId) return
    ws.sendPrompt(activeSessionId, input.trim())
    setInput('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/sessions" className="text-foreground-muted hover:text-foreground transition-colors">
            &larr; Sessions
          </Link>
          {displayProject && (
            <span className="font-medium font-mono text-sm">{displayProject}</span>
          )}
          {isRunning && (
            <span className="badge badge-info animate-pulse-glow">
              <span className="w-2 h-2 rounded-full bg-current mr-1.5 animate-pulse" />
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && activeSessionId && (
            <button
              onClick={() => ws.stopSession(activeSessionId)}
              className="btn btn-destructive px-3 py-1.5 text-sm"
            >
              Stop
            </button>
          )}
        </div>
      </header>

      {/* Messages area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 relative">
        {sdkMessages.length === 0 && streamState.blocks.length === 0 && (
          <div className="flex items-center justify-center h-full text-foreground-muted">
            {ws.connected ? 'Waiting for response...' : 'Connecting...'}
          </div>
        )}
        {sdkMessages.map((msg, i) => (
          <ChatMessage key={i} message={msg} toolResults={toolResults} />
        ))}

        {/* Streaming content */}
        {streamState.blocks.length > 0 && (
          <div className="flex gap-3 py-2">
            <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center text-secondary text-sm font-bold shrink-0">
              C
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              {streamState.blocks.map((block, i) => (
                <StreamingBlock key={i} block={block} />
              ))}
            </div>
          </div>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 btn btn-outline px-3 py-1.5 text-xs shadow-lg bg-background"
          >
            &darr; Scroll to bottom
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Wait for response to complete...' : 'Send a follow-up prompt...'}
            disabled={!activeSessionId || isRunning}
            rows={1}
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-foreground font-mono text-sm focus:border-primary focus:outline-none resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !activeSessionId || isRunning}
            className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
