'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ServerMessage, ClientMessage, UserPayload } from '@/types/ws'

interface UseSessionWebSocketOptions {
  onAuthenticated?: (user: UserPayload) => void
}

export function useSessionWebSocket(options?: UseSessionWebSocketOptions) {
  const [messages, setMessages] = useState<ServerMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onAuthenticatedRef = useRef(options?.onAuthenticated)
  onAuthenticatedRef.current = options?.onAuthenticated
  const bufferRef = useRef<ServerMessage[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subscribedSessionRef = useRef<string | null>(null)
  const intentionalCloseRef = useRef(false)
  const tokenRef = useRef<string | null>(null)

  const connectInternal = useCallback(async () => {
    // Clean up existing connection
    if (wsRef.current) {
      intentionalCloseRef.current = true
      wsRef.current.close()
      wsRef.current = null
    }

    // Get token (reuse if we have one, fetch if not)
    if (!tokenRef.current) {
      const res = await fetch('/api/auth/session')
      if (!res.ok) return
      const tokenRes = await fetch('/api/auth/ws-token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()
      tokenRef.current = token
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${tokenRef.current}`)

    ws.onopen = () => {
      setConnected(true)
      console.log('[WS] Connected')
    }

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data)

        if (message.type === 'authenticated') {
          onAuthenticatedRef.current?.(message.user)
          // Re-subscribe to session if we were watching one
          if (subscribedSessionRef.current) {
            console.log('[WS] Re-subscribing to session:', subscribedSessionRef.current)
            ws.send(JSON.stringify({ type: 'subscribe', sessionId: subscribedSessionRef.current }))
          }
        } else if (message.type === 'session_started') {
          setSessionId(message.sessionId)
        }

        // Buffer messages and flush in batch to avoid per-message re-renders
        bufferRef.current.push(message)

        const isFlushSignal = message.type === 'history_batch' || message.type === 'session_ended' || message.type === 'authenticated'
        if (isFlushSignal) {
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current)
            flushTimerRef.current = null
          }
          const batch = bufferRef.current
          bufferRef.current = []
          setMessages((prev) => [...prev, ...batch])
        } else if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null
            const batch = bufferRef.current
            bufferRef.current = []
            if (batch.length > 0) {
              setMessages((prev) => [...prev, ...batch])
            }
          }, 50)
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null

      if (!intentionalCloseRef.current) {
        // Unintentional close: reconnect after a short delay
        console.log('[WS] Connection lost, reconnecting in 2s...')
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          tokenRef.current = null // Force fresh token
          connectInternal()
        }, 2000)
      }
      intentionalCloseRef.current = false
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    wsRef.current = ws
  }, [])

  const connect = useCallback(async () => {
    intentionalCloseRef.current = false
    await connectInternal()
  }, [connectInternal])

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.warn('[WS] Cannot send, WebSocket not open')
    }
  }, [])

  const startSession = useCallback((data: {
    projectPath: string
    prompt: string
    permissionMode: string
    model?: string
  }) => {
    sendMessage({ type: 'start', ...data })
  }, [sendMessage])

  const sendPrompt = useCallback((sid: string, prompt: string) => {
    sendMessage({ type: 'send', sessionId: sid, prompt })
  }, [sendMessage])

  const stopSession = useCallback((sid: string) => {
    sendMessage({ type: 'stop', sessionId: sid })
  }, [sendMessage])

  const subscribe = useCallback((sid: string) => {
    subscribedSessionRef.current = sid
    sendMessage({ type: 'subscribe', sessionId: sid })
  }, [sendMessage])

  const loadPrevious = useCallback((sid: string, cursor: number) => {
    sendMessage({ type: 'load_previous', sessionId: sid, cursor })
  }, [sendMessage])

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      wsRef.current?.close()
    }
  }, [])

  return {
    messages,
    connected,
    sessionId,
    connect,
    disconnect,
    startSession,
    sendPrompt,
    stopSession,
    subscribe,
    loadPrevious,
    setMessages,
  }
}
