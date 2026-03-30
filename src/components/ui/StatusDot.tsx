import { cn } from './cn'

const dotColors = {
  running: 'bg-info',
  idle: 'bg-[#9ca3af]',
  completed: 'bg-success',
  error: 'bg-error',
} as const

interface StatusDotProps {
  status: keyof typeof dotColors
  className?: string
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'w-2 h-2 rounded-full inline-block',
        dotColors[status],
        status === 'running' && 'animate-pulse',
        className
      )}
    />
  )
}
