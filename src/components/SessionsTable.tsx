'use client'

import Link from 'next/link'
import type { SessionMeta } from '@/lib/store/types'
import { StatusBadge } from './StatusBadge'

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

export function SessionsTable({ sessions }: { sessions: SessionMeta[] }) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 text-foreground-muted">
        <p className="text-lg mb-2">No sessions yet</p>
        <p className="text-sm">Start a new session to begin.</p>
      </div>
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
            className="group block border border-border rounded-lg px-4 py-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              {/* Left: project + prompt */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium font-mono text-sm group-hover:text-primary transition-colors">{session.projectName}</span>
                  <StatusBadge status={session.status} />
                  <span className="text-foreground-muted/60 text-xs">{formatTime(session.updatedAt)}</span>
                </div>

                <div className="text-sm text-foreground">
                  {truncate(prompt, 140)}
                </div>
              </div>

              {/* Right: stats + arrow */}
              <div className="flex items-center gap-4 shrink-0 text-xs text-foreground-muted pt-1">
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
