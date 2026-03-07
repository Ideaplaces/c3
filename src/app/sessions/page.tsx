'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionMeta } from '@/lib/store/types'
import { SessionsTable } from '@/components/SessionsTable'
import { NewSessionDialog } from '@/components/NewSessionDialog'

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [user, setUser] = useState<{ email: string; name: string } | null>(null)

  const fetchSessions = useCallback(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 5000)

    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => setUser(data.user))
      .catch(console.error)

    return () => clearInterval(interval)
  }, [fetchSessions])

  const handleNewSession = (data: {
    projectPath: string
    prompt: string
    permissionMode: string
    model?: string
  }) => {
    // Navigate to a new session view that will handle the WS connection
    const params = new URLSearchParams({
      projectPath: data.projectPath,
      prompt: data.prompt,
      permissionMode: data.permissionMode,
      ...(data.model && { model: data.model }),
    })
    router.push(`/sessions/new?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-heading">
              <span className="text-gradient">CCC</span>
            </h1>
            <span className="text-foreground-muted text-sm hidden sm:inline">Cloud Claude Code</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {user && (
              <span className="text-sm text-foreground-muted hidden sm:inline">{user.name}</span>
            )}
            <button
              onClick={() => setDialogOpen(true)}
              className="btn btn-primary px-3 sm:px-4 py-2 text-sm"
            >
              <span className="sm:hidden">+ New</span>
              <span className="hidden sm:inline">+ New Session</span>
            </button>
            <a href="/api/auth/logout" className="btn btn-outline px-3 py-1.5 text-sm">
              Logout
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <SessionsTable sessions={sessions} loading={loading} />
      </main>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleNewSession}
      />
    </div>
  )
}
