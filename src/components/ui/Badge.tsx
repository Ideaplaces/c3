import { type HTMLAttributes } from 'react'
import { cn } from './cn'

const variants = {
  default: 'bg-primary/15 text-primary border-primary/30',
  secondary: 'bg-secondary/15 text-secondary border-secondary/30',
  success: 'bg-success-light text-success border-[rgba(76,175,80,0.3)]',
  warning: 'bg-warning-light text-warning border-[rgba(255,152,0,0.3)]',
  error: 'bg-error-light text-error border-[rgba(244,67,54,0.3)]',
  info: 'bg-info-light text-info border-[rgba(33,150,243,0.3)]',
  idle: 'bg-[rgba(156,163,175,0.15)] text-[#9ca3af] border-[rgba(156,163,175,0.3)]',
} as const

export type BadgeVariant = keyof typeof variants

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full border',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
