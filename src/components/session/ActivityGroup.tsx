'use client'

import { useState } from 'react'
import type { DisplayGroup } from '@/lib/sessions/message-grouping'
import { ChatMessage } from '@/components/ChatMessage'

interface ActivityGroupProps {
  group: DisplayGroup
  toolResults: Map<string, { content: string; isError: boolean }>
}

export function ActivityGroup({ group, toolResults }: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const count = group.toolSummaries?.length || 0

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 sm:px-3 py-2 flex items-center gap-1.5 sm:gap-2 text-left hover:bg-surface/50 transition-colors min-h-[44px]"
      >
        <span className="text-xs text-foreground-muted select-none shrink-0">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-xs text-foreground-muted shrink-0">
          {count} op{count !== 1 ? 's' : ''}
        </span>
        {!expanded && group.toolSummaries && group.toolSummaries.length > 0 && (
          <span className="text-xs text-foreground-muted/60 truncate flex-1 font-mono min-w-0">
            {group.toolSummaries.slice(-3).join(', ')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-1 sm:px-2 py-1 space-y-0.5 max-h-[400px] overflow-y-auto">
          {group.messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} toolResults={toolResults} />
          ))}
        </div>
      )}
    </div>
  )
}
