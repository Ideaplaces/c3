'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { ServerMessage } from '@/types/ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ChatMessage } from './ChatMessage'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useStreamAccumulator, type AccumulatedBlock } from '@/hooks/useStreamAccumulator'
import { getToolSummary } from '@/lib/messages/parser'

interface SessionViewProps {
  ws: {
    messages: ServerMessage[]
    connected: boolean
    sessionId: string | null
    sendPrompt: (sessionId: string, prompt: string, permissionMode?: string) => void
    stopSession: (sessionId: string) => void
    loadPrevious: (sessionId: string, cursor: number) => void
  }
  sessionId?: string
  projectName: string
  loadingStatus?: string
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-secondary" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function LoadingIndicator({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Spinner />
      <div className="text-foreground-muted text-sm">{status}</div>
      <div className="text-foreground-muted/50 text-xs">
        Claude Code is starting up — this can take 5-15 seconds
      </div>
    </div>
  )
}

function StreamingBlock({ block }: { block: AccumulatedBlock }) {
  if (block.type === 'thinking') {
    return (
      <details className="text-foreground-muted text-sm" open={!block.complete}>
        <summary className="cursor-pointer hover:text-foreground text-xs">
          {block.complete ? 'Thought' : 'Thinking...'}
        </summary>
        <div className="mt-1 pl-3 border-l-2 border-border whitespace-pre-wrap text-xs font-mono max-h-[200px] overflow-y-auto">
          {block.content}
        </div>
      </details>
    )
  }

  if (block.type === 'tool_use') {
    return (
      <div className="text-xs text-foreground-muted font-mono flex items-center gap-1.5 py-0.5">
        <span className="text-secondary">{'>'}</span>
        <span>{block.toolName}</span>
        {block.toolInput && (
          <span className="truncate opacity-60">{block.toolInput.slice(0, 60)}</span>
        )}
        {!block.complete && <Spinner />}
      </div>
    )
  }

  // text block
  return (
    <div className="text-sm whitespace-pre-wrap break-words">
      {block.content}
      {!block.complete && <span className="animate-pulse text-secondary">|</span>}
    </div>
  )
}

// Group messages into logical display groups
interface DisplayGroup {
  type: 'user' | 'assistant-text' | 'activity' | 'system' | 'result'
  messages: SDKMessage[]
  // For activity groups: summary of tool calls
  toolSummaries?: string[]
}

function groupMessages(messages: SDKMessage[]): DisplayGroup[] {
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
      // Check if this is a tool_result message (skip it)
      const content = msg.message.content
      if (Array.isArray(content)) {
        const hasToolResult = content.some(
          (block: unknown) => typeof block === 'object' && block !== null && 'type' in block && (block as { type: string }).type === 'tool_result'
        )
        if (hasToolResult) {
          // Tool results are part of the current activity flow
          currentActivity.push(msg)
          continue
        }
      }
      // Real user message
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
        // This assistant message has actual text content — show it prominently
        flushActivity()
        groups.push({ type: 'assistant-text', messages: [msg] })
      } else if (toolUses.length > 0) {
        // Tool-only message — accumulate into activity group
        currentActivity.push(msg)
        for (const tool of toolUses) {
          currentToolSummaries.push(
            getToolSummary(tool.name, tool.input as Record<string, unknown>)
          )
        }
      } else {
        // Thinking-only or empty — accumulate
        currentActivity.push(msg)
      }
      continue
    }

    // stream_event or other
    continue
  }

  flushActivity()
  return groups
}

function ActivityGroup({ group, toolResults }: {
  group: DisplayGroup
  toolResults: Map<string, { content: string; isError: boolean }>
}) {
  const [expanded, setExpanded] = useState(false)
  const count = group.toolSummaries?.length || 0

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 sm:px-3 py-2 flex items-center gap-1.5 sm:gap-2 text-left hover:bg-surface/50 transition-colors"
      >
        <span className="text-xs text-foreground-muted select-none shrink-0">{expanded ? '▼' : '▶'}</span>
        <span className="text-xs text-foreground-muted shrink-0">
          {count} op{count !== 1 ? 's' : ''}
        </span>
        {!expanded && group.toolSummaries && group.toolSummaries.length > 0 && (
          <span className="text-xs text-foreground-muted/60 truncate flex-1 font-mono min-w-0">
            — {group.toolSummaries.slice(-3).join(', ')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-1 sm:px-2 py-1 space-y-0.5 max-h-[400px] overflow-y-auto">
          {group.messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} toolResults={toolResults} />
          ))}
        </div>
      )}
    </div>
  )
}

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'bypass', color: 'text-info bg-info/10', enabled: true },
  { value: 'acceptEdits', label: 'auto-edit (coming soon)', color: 'text-warning bg-warning/10', enabled: false },
  { value: 'default', label: 'default (coming soon)', color: 'text-foreground-muted bg-surface', enabled: false },
] as const

export function SessionView({ ws, sessionId, projectName, loadingStatus }: SessionViewProps) {
  const [input, setInput] = useState('')
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [localUserMessages, setLocalUserMessages] = useState<{ text: string; ts: number }[]>([])
  const [prependedMessages, setPrependedMessages] = useState<ServerMessage[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { state: streamState, processEvent, reset: resetStream } = useStreamAccumulator()

  const activeSessionId = ws.sessionId || sessionId || null
  const isRunning = (() => {
    let lastStartIdx = -1
    let lastEndIdx = -1
    for (let i = ws.messages.length - 1; i >= 0; i--) {
      const m = ws.messages[i]
      if (lastStartIdx === -1 && m.type === 'session_started') lastStartIdx = i
      if (lastEndIdx === -1 && m.type === 'session_ended') lastEndIdx = i
      if (lastStartIdx !== -1 && lastEndIdx !== -1) break
    }
    return lastStartIdx > lastEndIdx
  })()

  // Extract complete SDK messages (non-streaming), including prepended history
  const allMessages = [...prependedMessages, ...ws.messages]
  const sdkMessages: SDKMessage[] = allMessages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type !== 'stream_event')

  // Build tool results map: tool_use_id -> { content, isError }
  const toolResults = useMemo(() => {
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
  }, [sdkMessages])

  // Group messages for display
  const displayGroups = useMemo(() => groupMessages(sdkMessages), [sdkMessages])

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

  // Handle history_batch messages (initial metadata + load_previous responses)
  useEffect(() => {
    const batches = ws.messages.filter(
      (m): m is ServerMessage & { type: 'history_batch' } => m.type === 'history_batch'
    )
    const lastBatch = batches[batches.length - 1]
    if (!lastBatch) return

    if (lastBatch.messages && lastBatch.messages.length > 0) {
      // This is a load_previous response with actual messages
      const scrollEl = containerRef.current
      const prevScrollHeight = scrollEl?.scrollHeight || 0

      const newMessages: ServerMessage[] = lastBatch.messages.map((msg) => ({
        type: 'sdk_event' as const,
        sessionId: lastBatch.sessionId,
        message: msg,
      }))
      setPrependedMessages((prev) => [...newMessages, ...prev])

      // Preserve scroll position after prepend
      requestAnimationFrame(() => {
        if (scrollEl) {
          const newScrollHeight = scrollEl.scrollHeight
          scrollEl.scrollTop += newScrollHeight - prevScrollHeight
        }
      })
    }

    setHistoryCursor(lastBatch.cursor)
    setHistoryHasMore(lastBatch.hasMore)
    setHistoryLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.messages.filter((m) => m.type === 'history_batch').length])

  // Scroll to bottom on initial load
  useEffect(() => {
    if (initialScrollDone) return
    if (sdkMessages.length === 0) return
    const scrollEl = containerRef.current
    if (scrollEl) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollEl.scrollHeight
        setInitialScrollDone(true)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMessages.length, initialScrollDone])

  const handleLoadPrevious = () => {
    if (!activeSessionId || historyCursor === null || !historyHasMore || historyLoading) return
    setHistoryLoading(true)
    ws.loadPrevious(activeSessionId, historyCursor)
  }

  // Auto-load previous messages when scrolling to the top
  const loadTriggerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const trigger = loadTriggerRef.current
    if (!trigger) return
    if (!historyHasMore || historyLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadPrevious()
        }
      },
      { root: containerRef.current, threshold: 0.1 }
    )
    observer.observe(trigger)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyHasMore, historyLoading, historyCursor, activeSessionId])

  // Detect project name from init message
  const initMessage = sdkMessages.find((m) => m.type === 'system' && 'subtype' in m && m.subtype === 'init')
  const displayProject = projectName || (initMessage && 'cwd' in initMessage ? String(initMessage.cwd).split('/').pop() : '')

  // Auto-scroll
  const { containerRef, showScrollButton, scrollToBottom } = useAutoScroll(
    streamState.blocks.length + sdkMessages.length
  )

  // Determine if we're still in initial loading
  const isLoading = loadingStatus && sdkMessages.length === 0 && streamState.blocks.length === 0

  const handleSend = () => {
    if (!input.trim() || !activeSessionId) return
    const text = input.trim()
    // Track the message locally so it appears immediately in the chat
    setLocalUserMessages((prev) => [...prev, { text, ts: Date.now() }])
    ws.sendPrompt(activeSessionId, text, permissionMode)
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
      <header className="border-b border-border px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/sessions" className="text-foreground-muted hover:text-foreground transition-colors text-sm shrink-0">
            &larr;<span className="hidden sm:inline"> Sessions</span>
          </Link>
          {displayProject && (
            <span className="font-medium font-mono text-sm truncate">{displayProject}</span>
          )}
          <select
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 cursor-pointer border-0 outline-none appearance-auto ${
              PERMISSION_MODES.find(m => m.value === permissionMode)?.color || 'bg-surface'
            }`}
          >
            {PERMISSION_MODES.map(mode => (
              <option key={mode.value} value={mode.value} disabled={!mode.enabled}>{mode.label}</option>
            ))}
          </select>
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 text-xs text-info shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
              <span className="hidden sm:inline">Running</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => activeSessionId && ws.stopSession(activeSessionId)}
            disabled={!isRunning || !activeSessionId}
            className="btn btn-destructive px-3 py-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Stop
          </button>
        </div>
      </header>

      {/* Messages area */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-2 relative">
        {isLoading ? (
          <LoadingIndicator status={loadingStatus} />
        ) : sdkMessages.length === 0 && streamState.blocks.length === 0 && !isRunning ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-foreground-muted text-sm">Session history unavailable (server was restarted).</div>
            <div className="text-foreground-muted/60 text-xs">You can send a follow-up message to continue the conversation.</div>
          </div>
        ) : sdkMessages.length === 0 && streamState.blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Spinner />
            <div className="text-foreground-muted text-sm">Waiting for Claude...</div>
          </div>
        ) : (
          <>
            {/* Auto-load trigger for previous messages */}
            {historyHasMore && (
              <div ref={loadTriggerRef} className="flex justify-center py-2">
                {historyLoading && (
                  <span className="flex items-center gap-2 text-xs text-foreground-muted"><Spinner /> Loading previous messages...</span>
                )}
              </div>
            )}

            {displayGroups.map((group, i) => {
              if (group.type === 'activity') {
                return <ActivityGroup key={i} group={group} toolResults={toolResults} />
              }
              // For non-activity groups, render each message directly
              return group.messages.map((msg, j) => (
                <ChatMessage key={`${i}-${j}`} message={msg} toolResults={toolResults} />
              ))
            })}

            {/* Local user message shown only while waiting for SDK to echo it back */}
            {localUserMessages
              .filter((m) => {
                // Hide if SDK already has a user text message with this content
                const sdkHasIt = sdkMessages.some(
                  (sdk) => sdk.type === 'user' && typeof sdk.message.content === 'string'
                    ? sdk.message.content === m.text
                    : Array.isArray(sdk.message.content) && sdk.message.content.some(
                        (b: unknown) => typeof b === 'object' && b !== null && 'type' in b
                          && (b as {type: string}).type === 'text'
                          && 'text' in b && (b as {text: string}).text === m.text
                      )
                )
                return !sdkHasIt
              })
              .map((m) => (
                <div key={`local-${m.ts}`} className="flex gap-2 sm:gap-3 py-3">
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    U
                  </div>
                  <div className="flex-1 text-sm whitespace-pre-wrap pt-0.5 min-w-0 break-words">
                    {m.text}
                  </div>
                </div>
              ))}

            {/* Streaming content */}
            {streamState.blocks.length > 0 && (
              <div className="flex gap-2 sm:gap-3 py-2">
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-secondary/20 flex items-center justify-center text-secondary text-xs font-bold shrink-0">
                  C
                </div>
                <div className="flex-1 space-y-1 min-w-0 break-words">
                  {streamState.blocks.map((block, i) => (
                    <StreamingBlock key={i} block={block} />
                  ))}
                </div>
              </div>
            )}

            {/* Show spinner when running but no new streaming content */}
            {isRunning && streamState.blocks.length === 0 && (
              <div className="flex items-center gap-2 py-2 text-foreground-muted text-xs">
                <Spinner />
                Claude is working...
              </div>
            )}
          </>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="sticky bottom-3 flex justify-center pointer-events-none">
            <button
              onClick={scrollToBottom}
              className="pointer-events-auto btn btn-outline px-3 py-1.5 text-xs shadow-lg bg-background border-border-light"
            >
              &darr; Scroll to bottom
            </button>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-2 sm:px-4 py-2 sm:py-3 shrink-0">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Wait for response...' : 'Send a follow-up prompt...'}
            disabled={!activeSessionId || isRunning}
            rows={1}
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-foreground font-mono text-sm focus:border-primary focus:outline-none resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !activeSessionId || isRunning}
            className="btn btn-primary px-3 sm:px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
