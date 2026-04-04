'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { SessionView } from '@/components/SessionView'
import { ALL_SCENARIOS } from '@/lib/test/mock-sessions'

function VisualTestInner() {
  const params = useSearchParams()
  const scenario = params.get('scenario') || 'short'
  const data = ALL_SCENARIOS[scenario as keyof typeof ALL_SCENARIOS]

  if (!data) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-bold mb-4">Unknown scenario: {scenario}</h1>
        <p>Available: {Object.keys(ALL_SCENARIOS).join(', ')}</p>
      </div>
    )
  }

  const mockWs = {
    messages: data.messages,
    connected: true,
    sessionId: 'mock-session-001',
    connect: () => {},
    sendPrompt: () => {},
    stopSession: () => {},
    loadPrevious: () => {},
  }

  return <SessionView ws={mockWs} sessionId="mock-session-001" projectName="my-project" loadingStatus="" />
}

export default function VisualTestPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading...</div>}>
      <VisualTestInner />
    </Suspense>
  )
}
