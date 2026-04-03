'use client'

import { useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'

interface SessionInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  isRunning: boolean
  autoFocus?: boolean
}

export function SessionInput({ value, onChange, onSend, disabled, isRunning, autoFocus }: SessionInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus && !isRunning) {
      inputRef.current?.focus()
    }
  }, [autoFocus, isRunning])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="border-t border-border px-2 sm:px-4 py-2 sm:py-3 shrink-0 bg-background z-10">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Wait for response...' : 'Send a follow-up prompt...'}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-foreground font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none disabled:opacity-50 min-h-[44px]"
        />
        <Button
          variant="primary"
          size="md"
          onClick={onSend}
          disabled={!value.trim() || disabled}
          className="shrink-0"
        >
          Send
        </Button>
      </div>
    </div>
  )
}
