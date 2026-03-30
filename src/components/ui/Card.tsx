import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'interactive'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'bg-card text-card-foreground border border-border rounded-lg transition-all duration-200',
          variant === 'interactive' && 'hover:border-primary hover:shadow-[0_0_30px_rgba(255,79,109,0.1)] cursor-pointer',
          variant === 'default' && 'hover:border-border-light',
          className
        )}
        {...props}
      />
    )
  }
)

Card.displayName = 'Card'
