'use client'

import type { AccumulatedBlock } from '@/hooks/useStreamAccumulator'
import { Spinner } from './Spinner'

export function StreamingBlock({ block }: { block: AccumulatedBlock }) {
  if (block.type === 'thinking') {
    return (
      <details className="text-foreground-muted text-sm" open={!block.complete}>
        <summary className="cursor-pointer hover:text-foreground text-xs">
          {block.complete ? 'Thought' : 'Thinking...'}
        </summary>
        <div className="mt-1 pl-3 border-l-2 border-border whitespace-pre-wrap text-xs font-mono max-h-[200px] overflow-y-auto">
          {block.content}
        </div>
      </details>
    )
  }

  if (block.type === 'tool_use') {
    return (
      <div className="text-xs text-foreground-muted font-mono flex items-center gap-1.5 py-0.5">
        <span className="text-secondary">{'>'}</span>
        <span>{block.toolName}</span>
        {block.toolInput && (
          <span className="truncate opacity-60">{block.toolInput.slice(0, 60)}</span>
        )}
        {!block.complete && <Spinner />}
      </div>
    )
  }

  return (
    <div className="text-sm whitespace-pre-wrap break-words">
      {block.content}
      {!block.complete && <span className="animate-pulse text-secondary">|</span>}
    </div>
  )
}
