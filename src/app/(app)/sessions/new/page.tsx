'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { SessionView } from '@/components/SessionView'
import { Suspense } from 'react'

function NewSessionContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const ws = useSessionWebSocket()
  const startedRef = useRef(false)
  const connectingRef = useRef(false)
  const [status, setStatus] = useState('Connecting...')

  const projectPath = searchParams.get('projectPath') || ''
  const prompt = searchParams.get('prompt') || ''
  const permissionMode = searchParams.get('permissionMode') || 'bypassPermissions'
  const model = searchParams.get('model') || undefined

  // Step 1: Connect WebSocket
  useEffect(() => {
    if (!projectPath || !prompt) {
      router.push('/sessions')
      return
    }
    if (connectingRef.current) return
    connectingRef.current = true
    setStatus('Connecting to server...')
    ws.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, prompt])

  // Step 2: Start session after authentication
  useEffect(() => {
    if (startedRef.current) return

    const hasAuth = ws.messages.some((m) => m.type === 'authenticated')
    if (!hasAuth) return

    startedRef.current = true
    setStatus('Starting Claude Code session...')
    console.log('[CCC] Sending start message:', { projectPath, permissionMode, model })
    ws.startSession({ projectPath, prompt, permissionMode, model })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.messages])

  // Step 3: Update status based on SDK events
  useEffect(() => {
    const hasSessionStarted = ws.messages.some((m) => m.type === 'session_started')
    if (hasSessionStarted) {
      setStatus('Claude is initializing...')
    }

    const hasSdkInit = ws.messages.some(
      (m) => m.type === 'sdk_event' && (m.message as { type: string }).type === 'system'
    )
    if (hasSdkInit) {
      setStatus('')
    }

    const hasError = ws.messages.find((m) => m.type === 'error')
    if (hasError && hasError.type === 'error') {
      setStatus(`Error: ${hasError.message}`)
    }
  }, [ws.messages])

  // Update URL to reflect the real session ID (without navigation/remount)
  useEffect(() => {
    if (ws.sessionId) {
      window.history.replaceState(null, '', `/sessions/${ws.sessionId}`)
    }
  }, [ws.sessionId])

  return <SessionView ws={ws} projectName={projectPath.split('/').pop() || ''} loadingStatus={status} />
}

export default function NewSessionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    }>
      <NewSessionContent />
    </Suspense>
  )
}
