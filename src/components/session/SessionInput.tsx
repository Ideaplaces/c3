'use client'

import { useRef, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

interface SessionInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  isRunning: boolean
  autoFocus?: boolean
  resumeCommand?: string
}

export function SessionInput({ value, onChange, onSend, disabled, isRunning, autoFocus, resumeCommand }: SessionInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)

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

  const handleCopyResume = () => {
    if (!resumeCommand) return
    navigator.clipboard.writeText(resumeCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        {resumeCommand && (
          <button
            onClick={handleCopyResume}
            className="hidden sm:flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs text-foreground-muted hover:text-foreground border border-border rounded-md hover:bg-surface transition-colors"
            title={resumeCommand}
          >
            {copied ? 'Copied!' : 'Continue in terminal'}
          </button>
        )}
      </div>
    </div>
  )
}
