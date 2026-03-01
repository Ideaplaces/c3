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

  const connect = useCallback(async () => {
    // Get JWT token from session endpoint
    const res = await fetch('/api/auth/session')
    if (!res.ok) return

    // Get the token from the cookie directly isn't possible from client
    // Instead, we'll get it via a dedicated endpoint
    const tokenRes = await fetch('/api/auth/ws-token')
    if (!tokenRes.ok) return
    const { token } = await tokenRes.json()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data)

        if (message.type === 'authenticated') {
          onAuthenticatedRef.current?.(message.user)
        } else if (message.type === 'session_started') {
          setSessionId(message.sessionId)
        }

        setMessages((prev) => [...prev, message])
      } catch (e) {
        console.error('Failed to parse WS message:', e)
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    wsRef.current = ws
  }, [])

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
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
    sendMessage({ type: 'subscribe', sessionId: sid })
  }, [sendMessage])

  const loadPrevious = useCallback((sid: string, cursor: number) => {
    sendMessage({ type: 'load_previous', sessionId: sid, cursor })
  }, [sendMessage])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    return () => {
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
