'use client'

import Link from 'next/link'
import type { SessionMeta } from '@/lib/store/types'
import { StatusBadge } from './StatusBadge'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { Button } from './ui/Button'

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatCost(usd: number): string {
  if (usd === 0) return '-'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  const clean = text.replace(/\n/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max) + '...'
}

const statusBorderColor: Record<string, string> = {
  running: 'border-l-primary',
  completed: 'border-l-success',
  error: 'border-l-error',
  idle: 'border-l-border-light',
}

function SessionSkeletons() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-border rounded-lg px-3 sm:px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="hidden sm:flex items-center gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface SessionsTableProps {
  sessions: SessionMeta[]
  loading?: boolean
  onNewSession?: () => void
}

export function SessionsTable({ sessions, loading, onNewSession }: SessionsTableProps) {
  if (loading) {
    return <SessionSkeletons />
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={
          <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
        }
        title="No sessions yet"
        description="Start a new session to begin working with Claude Code."
        action={onNewSession && (
          <Button variant="primary" onClick={onNewSession}>
            Start your first session
          </Button>
        )}
      />
    )
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const prompt = session.firstPrompt || session.lastPrompt || ''

        return (
          <Link
            key={session.id}
            href={`/sessions/${session.id}`}
            className={`group block border border-border rounded-lg border-l-4 ${statusBorderColor[session.status] || 'border-l-border'} px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all`}
          >
            <div className="flex items-start justify-between gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium font-mono text-sm group-hover:text-primary transition-colors truncate max-w-[200px] sm:max-w-none">{session.projectName}</span>
                  <StatusBadge status={session.status} />
                  <span className="text-foreground-muted/60 text-xs">{formatTime(session.updatedAt)}</span>
                </div>

                <div className="text-sm text-foreground line-clamp-2 sm:line-clamp-1">
                  {truncate(prompt, 140)}
                </div>

                {/* Mobile-only stats row */}
                <div className="flex sm:hidden items-center gap-3 mt-1.5 text-xs text-foreground-muted/60">
                  {session.turnCount > 0 && <span>{session.turnCount} turns</span>}
                  {session.totalCostUsd > 0 && <span>{formatCost(session.totalCostUsd)}</span>}
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs text-foreground-muted pt-1">
                {session.turnCount > 0 && (
                  <span>{session.turnCount} turns</span>
                )}
                <span>{formatCost(session.totalCostUsd)}</span>
                <span className="text-foreground-muted/40 group-hover:text-primary transition-colors">&rarr;</span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
