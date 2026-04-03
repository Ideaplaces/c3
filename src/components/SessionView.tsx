'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type { ServerMessage } from '@/types/ws'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ChatMessage } from './ChatMessage'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useStreamAccumulator } from '@/hooks/useStreamAccumulator'
import { groupMessages, extractToolResults, getSessionStatus } from '@/lib/sessions/message-grouping'
import { SessionHeader } from './session/SessionHeader'
import { SessionInput } from './session/SessionInput'
import { Spinner } from './session/Spinner'
import { StreamingBlock } from './session/StreamingBlock'
import { ActivityGroup } from './session/ActivityGroup'

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

export function SessionView({ ws, sessionId, projectName, loadingStatus }: SessionViewProps) {
  const [input, setInput] = useState('')
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [prependedMessages, setPrependedMessages] = useState<ServerMessage[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { state: streamState, processEvent, reset: resetStream } = useStreamAccumulator()

  const activeSessionId = ws.sessionId || sessionId || null
  const { isRunning } = getSessionStatus(ws.messages)

  const allMessages = [...prependedMessages, ...ws.messages]
  const sdkMessages: SDKMessage[] = allMessages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type !== 'stream_event')

  const toolResults = useMemo(() => extractToolResults(sdkMessages), [sdkMessages])
  const displayGroups = useMemo(() => groupMessages(sdkMessages), [sdkMessages])

  const streamEvents = ws.messages
    .filter((m): m is ServerMessage & { type: 'sdk_event' } => m.type === 'sdk_event')
    .map((m) => m.message as SDKMessage)
    .filter((m) => m.type === 'stream_event')

  // Process stream events
  useEffect(() => {
    const lastEvent = streamEvents[streamEvents.length - 1]
    if (lastEvent && lastEvent.type === 'stream_event') {
      processEvent(lastEvent.event)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamEvents.length])

  // Reset stream when assistant message finalizes
  useEffect(() => {
    const lastMsg = sdkMessages[sdkMessages.length - 1]
    if (lastMsg?.type === 'assistant') {
      resetStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMessages.length])

  // Handle history batches (prepend older messages)
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

  // Mark as ready and scroll to bottom once messages arrive.
  // Uses scrollIntoView on a sentinel div at the end of messages for reliable mobile support.
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (scrolledRef.current) return
    if (sdkMessages.length === 0) return
    scrolledRef.current = true
    // Wait for DOM to settle, then scroll sentinel into view and reveal
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView()
      setReady(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMessages.length])

  // Infinite scroll: load previous messages
  const loadTriggerRef = useRef<HTMLDivElement>(null)
  const handleLoadPrevious = useCallback(() => {
    if (!activeSessionId || historyCursor === null || !historyHasMore || historyLoading) return
    setHistoryLoading(true)
    ws.loadPrevious(activeSessionId, historyCursor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, historyCursor, historyHasMore, historyLoading])

  useEffect(() => {
    const trigger = loadTriggerRef.current
    if (!trigger) return
    if (!historyHasMore || historyLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) handleLoadPrevious()
      },
      { root: containerRef.current, threshold: 0.1 }
    )
    observer.observe(trigger)
    return () => observer.disconnect()
  }, [historyHasMore, historyLoading, handleLoadPrevious])

  const initMessage = sdkMessages.find((m) => m.type === 'system' && 'subtype' in m && m.subtype === 'init')
  const displayProject = projectName || (initMessage && 'cwd' in initMessage ? String(initMessage.cwd).split('/').pop() : '') || ''

  const { containerRef, showScrollButton, scrollToBottom } = useAutoScroll(
    streamState.blocks.length + sdkMessages.length
  )

  const isLoading = loadingStatus && sdkMessages.length === 0 && streamState.blocks.length === 0
  const hasMessages = sdkMessages.length > 0 || streamState.blocks.length > 0

  const handleSend = () => {
    if (!input.trim() || !activeSessionId) return
    ws.sendPrompt(activeSessionId, input.trim(), permissionMode)
    setInput('')
  }

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      <SessionHeader
        projectName={displayProject}
        isRunning={isRunning}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        onStop={() => activeSessionId && ws.stopSession(activeSessionId)}
        canStop={isRunning && !!activeSessionId}
      />

      {/* Messages area. Hidden until first scroll-to-bottom completes. */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-2 ${
          !ready && hasMessages ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Spinner />
            <div className="text-foreground-muted text-sm">{loadingStatus}</div>
            <div className="text-foreground-muted/50 text-xs">Claude Code is starting up</div>
          </div>
        ) : !hasMessages && !isRunning ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-foreground-muted text-sm">Session history unavailable (server was restarted).</div>
            <div className="text-foreground-muted/60 text-xs">You can send a follow-up message to continue the conversation.</div>
          </div>
        ) : !hasMessages ? (
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

            {/* Scroll sentinel */}
            <div ref={messagesEndRef} />
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

      <SessionInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={!activeSessionId || isRunning}
        isRunning={isRunning}
        autoFocus={ready}
      />
    </div>
  )
}
