'use client'

import { useEffect, useRef, useState, use } from 'react'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { SessionView } from '@/components/SessionView'

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const ws = useSessionWebSocket()
  const connectedRef = useRef(false)
  const subscribedRef = useRef(false)
  const [status, setStatus] = useState('Reconnecting to session...')

  // Step 1: Connect WebSocket
  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true
    ws.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Step 2: Subscribe to session after authentication
  useEffect(() => {
    if (subscribedRef.current) return

    const hasAuth = ws.messages.some((m) => m.type === 'authenticated')
    if (!hasAuth) return

    subscribedRef.current = true
    setStatus('Loading session...')
    console.log('[CCC] Subscribing to session:', id)
    ws.subscribe(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.messages])

  // Step 3: Clear status once we have SDK events
  useEffect(() => {
    const hasSdkEvent = ws.messages.some((m) => m.type === 'sdk_event')
    const hasEnded = ws.messages.some((m) => m.type === 'session_ended')
    if (hasSdkEvent || hasEnded) {
      setStatus('')
    }
  }, [ws.messages])

  return <SessionView ws={ws} sessionId={id} projectName="" loadingStatus={status} />
}
