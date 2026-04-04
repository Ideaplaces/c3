'use client'

import { useRef, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

interface SessionInputProps {
  onSend: (text: string) => void
  disabled: boolean
  isRunning: boolean
  autoFocus?: boolean
  resumeCommand?: string
}

export function SessionInput({ onSend, disabled, isRunning, autoFocus, resumeCommand }: SessionInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (autoFocus && !isRunning) {
      inputRef.current?.focus()
    }
  }, [autoFocus, isRunning])

  const handleSend = () => {
    if (!value.trim() || disabled) return
    onSend(value.trim())
    setValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopyResume = () => {
    if (!resumeCommand) return
    navigator.clipboard.writeText(resumeCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="border-t border-border px-2 sm:px-4 py-2 sm:py-3 pb-[env(safe-area-inset-bottom,8px)] shrink-0 bg-background z-10 overflow-hidden">
      <div className="flex gap-1.5 sm:gap-2 w-full">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Wait for response...' : 'Send a follow-up prompt...'}
          disabled={disabled}
          rows={1}
          className="flex-1 min-w-0 bg-surface border border-border rounded-md px-2 sm:px-3 py-2 text-foreground font-mono text-base sm:text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none disabled:opacity-50 min-h-[44px]"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="shrink-0 sm:!px-4 sm:!py-2 sm:!text-sm sm:!min-h-[40px]"
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
