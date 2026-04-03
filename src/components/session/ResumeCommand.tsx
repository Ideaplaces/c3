'use client'

import { useState } from 'react'

interface ResumeCommandProps {
  sessionId: string
  projectPath?: string
}

export function ResumeCommand({ sessionId, projectPath }: ResumeCommandProps) {
  const [copied, setCopied] = useState(false)

  const parts: string[] = []
  if (projectPath) parts.push(`cd ${projectPath}`)
  parts.push(`claude --resume ${sessionId} --dangerously-skip-permissions`)
  const command = parts.join(' && ')

  const handleCopy = () => {
    navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-md px-2 py-1.5 font-mono text-xs text-foreground-muted overflow-hidden">
      <code className="truncate flex-1 select-all">{command}</code>
      <button
        onClick={handleCopy}
        className="shrink-0 px-2 py-0.5 rounded text-[10px] border border-border hover:bg-background transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
