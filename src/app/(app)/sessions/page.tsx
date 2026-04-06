'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionMeta } from '@/lib/store/types'
import { SessionsTable } from '@/components/SessionsTable'
import { NewSessionDialog } from '@/components/NewSessionDialog'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'

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
      <header className="border-b border-border px-4 sm:px-6 py-3 sm:py-4 relative">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Logo size={32} />
            <span className="text-foreground-muted text-sm hidden sm:inline">Cloud Claude Code</span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            {user && (
              <span className="text-sm text-foreground-muted hidden sm:inline">{user.name}</span>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={() => setDialogOpen(true)}
            >
              <span className="sm:hidden">+ New</span>
              <span className="hidden sm:inline">+ New Session</span>
            </Button>
            <a
              href="/api/auth/logout"
              className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-transparent border border-border text-foreground hover:bg-muted px-2.5 py-1 text-xs min-h-[32px]"
            >
              Logout
            </a>
          </div>
        </div>
        {/* Header glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <SessionsTable sessions={sessions} loading={loading} onNewSession={() => setDialogOpen(true)} />
      </main>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleNewSession}
      />
    </div>
  )
}
