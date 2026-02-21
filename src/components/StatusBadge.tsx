import type { SessionStatus } from '@/lib/store/types'

const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
  running: {
    label: 'Running',
    className: 'badge-info animate-pulse-glow',
  },
  idle: {
    label: 'Idle',
    className: 'bg-[rgba(156,163,175,0.15)] text-[#9ca3af] border-[rgba(156,163,175,0.3)]',
  },
  completed: {
    label: 'Completed',
    className: 'badge-success',
  },
  error: {
    label: 'Error',
    className: 'badge-error',
  },
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status]
  return (
    <span className={`badge ${config.className}`}>
      {status === 'running' && (
        <span className="w-2 h-2 rounded-full bg-current mr-2 animate-pulse" />
      )}
      {config.label}
    </span>
  )
}
