'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { SessionView } from '@/components/SessionView'
import { Suspense } from 'react'

function NewSessionContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const ws = useSessionWebSocket()
  const startedRef = useRef(false)

  const projectPath = searchParams.get('projectPath') || ''
  const prompt = searchParams.get('prompt') || ''
  const permissionMode = searchParams.get('permissionMode') || 'bypassPermissions'
  const model = searchParams.get('model') || undefined

  useEffect(() => {
    if (!projectPath || !prompt) {
      router.push('/sessions')
      return
    }

    ws.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Start session after connection + authentication
  useEffect(() => {
    if (!ws.connected || startedRef.current) return

    const hasAuth = ws.messages.some((m) => m.type === 'authenticated')
    if (!hasAuth) return

    startedRef.current = true
    ws.startSession({ projectPath, prompt, permissionMode, model })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.connected, ws.messages])

  // Redirect once session is created so URL reflects the real session ID
  useEffect(() => {
    if (ws.sessionId) {
      router.replace(`/sessions/${ws.sessionId}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.sessionId])

  return <SessionView ws={ws} projectName={projectPath.split('/').pop() || ''} />
}

export default function NewSessionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground-muted">Connecting...</div>
      </div>
    }>
      <NewSessionContent />
    </Suspense>
  )
}
