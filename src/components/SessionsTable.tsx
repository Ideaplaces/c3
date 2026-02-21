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
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Status</th>
            <th>Last Prompt</th>
            <th>Turns</th>
            <th>Cost</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="font-medium">{session.projectName}</td>
              <td><StatusBadge status={session.status} /></td>
              <td className="max-w-xs truncate text-foreground-muted text-sm font-mono">
                {session.lastPrompt}
              </td>
              <td className="text-foreground-muted">{session.turnCount}</td>
              <td className="text-foreground-muted">{formatCost(session.totalCostUsd)}</td>
              <td className="text-foreground-muted text-sm">{formatTime(session.updatedAt)}</td>
              <td>
                <Link
                  href={`/sessions/${session.id}`}
                  className="btn btn-outline px-3 py-1 text-sm"
                >
                  {session.status === 'running' ? 'View' : 'Resume'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
