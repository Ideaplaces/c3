import Image from 'next/image'
import { cn } from './cn'

interface LogoProps {
  size?: number
  className?: string
}

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <Image
      src="/c3-logo-128.png"
      alt="C3"
      width={size}
      height={size}
      className={cn('inline-block', className)}
      priority
    />
  )
}
