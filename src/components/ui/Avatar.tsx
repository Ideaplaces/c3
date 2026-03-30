import { cn } from './cn'

const colorVariants = {
  primary: 'bg-primary/20 text-primary',
  secondary: 'bg-secondary/20 text-secondary',
  accent: 'bg-accent/20 text-accent',
  muted: 'bg-muted text-foreground-muted',
} as const

const sizeVariants = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
} as const

interface AvatarProps {
  name: string
  color?: keyof typeof colorVariants
  size?: keyof typeof sizeVariants
  className?: string
}

export function Avatar({ name, color = 'primary', size = 'sm', className }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold shrink-0',
        colorVariants[color],
        sizeVariants[size],
        className
      )}
    >
      {initial}
    </div>
  )
}
