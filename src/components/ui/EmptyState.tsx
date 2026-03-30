import { type ReactNode } from 'react'
import { cn } from './cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && (
        <div className="mb-4 text-foreground-muted/40">
          {icon}
        </div>
      )}
      <p className="text-lg font-medium text-foreground-muted mb-1">{title}</p>
      {description && (
        <p className="text-sm text-foreground-muted/60 max-w-sm">{description}</p>
      )}
      {action && (
        <div className="mt-6">
          {action}
        </div>
      )}
    </div>
  )
}
