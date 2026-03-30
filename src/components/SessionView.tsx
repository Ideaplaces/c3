'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { ServerMessage } from '@/types/ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ChatMessage } from './ChatMessage'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
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
        Claude Code is starting up
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
        className="w-full px-2 sm:px-3 py-2 flex items-center gap-1.5 sm:gap-2 text-left hover:bg-surface/50 transition-colors min-h-[44px]"
      >
        <span className="text-xs text-foreground-muted select-none shrink-0">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-xs text-foreground-muted shrink-0">
          {count} op{count !== 1 ? 's' : ''}
        </span>
        {!expanded && group.toolSummaries && group.toolSummaries.length > 0 && (
          <span className="text-xs text-foreground-muted/60 truncate flex-1 font-mono min-w-0">
            {group.toolSummaries.slice(-3).join(', ')}
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
  const [localUserMessages, setLocalUserMessages] = useState<{ text: string; ts: number; sdkUserCountAtSend: number }[]>([])
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

  const allMessages = [...prependedMessages, ...ws.messages]
  const sdkMessages: SDKMessage[] = allMessages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type !== 'stream_event')

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

  const displayGroups = useMemo(() => groupMessages(sdkMessages), [sdkMessages])

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

  useEffect(() => {
    const lastMsg = sdkMessages[sdkMessages.length - 1]
    if (lastMsg?.type === 'assistant') {
      resetStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMessages.length])

  useEffect(() => {
    const batches = ws.messages.filter(
      (m): m is ServerMessage & { type: 'history_batch' } => m.type === 'history_batch'
    )
    const lastBatch = batches[batches.length - 1]
    if (!lastBatch) return

    if (lastBatch.messages && lastBatch.messages.length > 0) {
      const scrollEl = containerRef.current
      const prevScrollHeight = scrollEl?.scrollHeight || 0

      const newMessages: ServerMessage[] = lastBatch.messages.map((msg) => ({
        type: 'sdk_event' as const,
        sessionId: lastBatch.sessionId,
        message: msg,
      }))
      setPrependedMessages((prev) => [...newMessages, ...prev])

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

  const initMessage = sdkMessages.find((m) => m.type === 'system' && 'subtype' in m && m.subtype === 'init')
  const displayProject = projectName || (initMessage && 'cwd' in initMessage ? String(initMessage.cwd).split('/').pop() : '')

  const { containerRef, showScrollButton, scrollToBottom } = useAutoScroll(
    streamState.blocks.length + sdkMessages.length
  )

  const isLoading = loadingStatus && sdkMessages.length === 0 && streamState.blocks.length === 0

  const handleSend = () => {
    if (!input.trim() || !activeSessionId) return
    const text = input.trim()
    const currentUserTextCount = sdkMessages.filter((sdk) => {
      if (sdk.type !== 'user') return false
      const content = sdk.message.content
      if (Array.isArray(content)) {
        return content.some((b: unknown) =>
          typeof b === 'object' && b !== null && 'type' in b && (b as {type: string}).type === 'text'
        )
      }
      return typeof content === 'string'
    }).length
    setLocalUserMessages((prev) => [...prev, { text, ts: Date.now(), sdkUserCountAtSend: currentUserTextCount }])
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

  // Suppress unused var warning
  void localUserMessages

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between shrink-0 relative">
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
          <Button
            variant="destructive"
            size="sm"
            onClick={() => activeSessionId && ws.stopSession(activeSessionId)}
            disabled={!isRunning || !activeSessionId}
          >
            Stop
          </Button>
        </div>
        {/* Header glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
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
              return group.messages.map((msg, j) => (
                <ChatMessage key={`${i}-${j}`} message={msg} toolResults={toolResults} />
              ))
            })}

            {/* Streaming content */}
            {streamState.blocks.length > 0 && (
              <div className="flex gap-2 sm:gap-3 py-2">
                <Avatar name="Claude" color="secondary" size="sm" />
                <div className="flex-1 space-y-1 min-w-0 break-words">
                  {streamState.blocks.map((block, i) => (
                    <StreamingBlock key={i} block={block} />
                  ))}
                </div>
              </div>
            )}

            {isRunning && streamState.blocks.length === 0 && (
              <div className="flex items-center gap-2 py-2 text-foreground-muted text-xs">
                <Spinner />
                Claude is working...
              </div>
            )}
          </>
        )}

        {showScrollButton && (
          <div className="sticky bottom-3 flex justify-center pointer-events-none">
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToBottom}
              className="pointer-events-auto shadow-lg bg-background border-border-light"
            >
              &darr; Scroll to bottom
            </Button>
          </div>
        )}
      </div>

      {/* Input area - fixed on mobile */}
      <div className="border-t border-border px-2 sm:px-4 py-2 sm:py-3 shrink-0 bg-background">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Wait for response...' : 'Send a follow-up prompt...'}
            disabled={!activeSessionId || isRunning}
            rows={1}
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-foreground font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none disabled:opacity-50 min-h-[44px]"
          />
          <Button
            variant="primary"
            size="md"
            onClick={handleSend}
            disabled={!input.trim() || !activeSessionId || isRunning}
            className="shrink-0"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
