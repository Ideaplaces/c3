'use client'

import { useEffect, useRef, use } from 'react'
import { useSessionWebSocket } from '@/hooks/useSessionWebSocket'
import { SessionView } from '@/components/SessionView'

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const ws = useSessionWebSocket()
  const connectedRef = useRef(false)

  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true
    ws.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <SessionView ws={ws} sessionId={id} projectName="" />
}
