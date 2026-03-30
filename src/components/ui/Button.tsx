import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const variants = {
  primary:
    'bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary-dark hover:shadow-[0_0_30px_rgba(255,79,109,0.6)] focus-visible:ring-primary',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary-light focus-visible:ring-secondary',
  outline:
    'bg-transparent border border-border text-foreground hover:bg-muted focus-visible:ring-ring',
  ghost:
    'bg-transparent text-foreground hover:bg-muted focus-visible:ring-ring',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-error focus-visible:ring-destructive',
} as const

const sizes = {
  sm: 'px-2.5 py-1 text-xs min-h-[32px]',
  md: 'px-3 sm:px-4 py-2 text-sm min-h-[40px]',
  lg: 'px-5 py-2.5 text-base min-h-[44px]',
} as const

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
