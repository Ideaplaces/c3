'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionMeta } from '@/lib/store/types'
import { SessionsTable } from '@/components/SessionsTable'
import { NewSessionForm, type NewSessionData } from '@/components/NewSessionForm'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'

// The sessions list is opt-in: the page is for starting a session.
const POLL_MS = 15000

type Scope = 'web' | 'all'

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [showSessions, setShowSessions] = useState(false)
  const [scope, setScope] = useState<Scope>('web')
  const [user, setUser] = useState<{ email: string; name: string } | null>(null)

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/session')
        const data = await res.json()
        setUser(data.user)
      } catch (err) {
        console.error(err)
      }
    }
    loadUser()
  }, [])

  useEffect(() => {
    if (!showSessions) return
    // An answer for a scope the page has left, or a poll overtaken by a newer one, is dropped
    let current = true
    const controller = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const res = await fetch(`/api/sessions?scope=${scope}&limit=50`, { signal: controller.signal })
        const data = await res.json()
        if (current) setSessions(data.sessions)
      } catch (err) {
        if (current) console.error(err)
      } finally {
        inFlight = false
        if (current) setLoading(false)
      }
    }
    setLoading(true)
    load()
    const interval = setInterval(load, POLL_MS)
    return () => {
      current = false
      controller.abort()
      clearInterval(interval)
    }
  }, [showSessions, scope])

  const handleNewSession = (data: NewSessionData) => {
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
            <a href="/triggers">
              <Button variant="outline" size="sm">
                <span className="sm:hidden">Triggers</span>
                <span className="hidden sm:inline">Triggers</span>
              </Button>
            </a>
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
      <main className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6">
        <section className="border border-border rounded-lg p-4 sm:p-6">
          <NewSessionForm onSubmit={handleNewSession} />
        </section>

        <section>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSessions((v) => !v)}
            aria-expanded={showSessions}
            className="w-full"
          >
            {showSessions ? 'Hide sessions' : 'Show sessions'}
          </Button>
          {showSessions && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                {([
                  { value: 'web', label: 'Started here' },
                  { value: 'all', label: 'Everything' },
                ] as const).map((s) => (
                  <Button
                    key={s.value}
                    variant={scope === s.value ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setScope(s.value)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <SessionsTable sessions={sessions} loading={loading} />
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
