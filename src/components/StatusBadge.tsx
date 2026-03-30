import type { SessionStatus } from '@/lib/store/types'
import { Badge, type BadgeVariant } from './ui/Badge'
import { StatusDot } from './ui/StatusDot'

const statusConfig: Record<SessionStatus, { label: string; variant: BadgeVariant }> = {
  running: { label: 'Running', variant: 'info' },
  idle: { label: 'Idle', variant: 'idle' },
  completed: { label: 'Completed', variant: 'success' },
  error: { label: 'Error', variant: 'error' },
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status]
  return (
    <Badge variant={config.variant} className={status === 'running' ? 'animate-pulse-glow' : ''}>
      {status === 'running' && <StatusDot status="running" className="mr-2" />}
      {config.label}
    </Badge>
  )
}
